import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv
from torch_geometric.data import Data
from torch_geometric.loader import DataLoader
import numpy as np
import random
import collections
from rlcard.utils import set_seed
from custom_kuhn_chipev import KuhnPokerGame

class GNN_Q_Net(nn.Module):
    def __init__(self, num_node_features, num_actions):
        super(GNN_Q_Net, self).__init__()
        self.conv1 = GCNConv(num_node_features, 128)
        self.fc1 = nn.Linear(128, 128)
        self.fc2 = nn.Linear(128, num_actions)

    def forward(self, data):
        x, edge_index, batch = data.x, data.edge_index, data.batch
        x = F.relu(self.conv1(x, edge_index))
        from torch_geometric.nn import global_mean_pool
        x = global_mean_pool(x, batch)
        x = F.relu(self.fc1(x))
        return self.fc2(x)

def convert_state_to_graph(state, num_players, num_node_features):
    edge_list = []
    for i in range(num_players): edge_list.append([i, (i + 1) % num_players])
    edge_index = torch.tensor(edge_list, dtype=torch.long).t().contiguous()
    obs = torch.from_numpy(state['obs']).float()
    x_nodes = obs.unsqueeze(0).repeat(num_players, 1)
    if x_nodes.shape[1] < num_node_features:
        padding = torch.zeros(num_players, num_node_features - x_nodes.shape[1])
        x_nodes = torch.cat([x_nodes, padding], dim=1)
    return Data(x=x_nodes, edge_index=edge_index)

class StandaloneGnnAgent(object):
    def __init__(self, num_actions, state_shape, num_players, device, **kwargs):
        self.num_actions = num_actions
        self.device = device
        self.num_players = num_players
        self.num_node_features = state_shape[0][0]
        self.replay_memory = collections.deque(maxlen=kwargs.get('replay_memory_size', 20000))
        self.batch_size = kwargs.get('batch_size', 32)
        self.update_target_every = kwargs.get('update_target_every', 1000)
        self.discount_factor = kwargs.get('discount_factor', 0.99)
        self.step_counter = 0
        epsilon_start, epsilon_end, epsilon_decay_steps = kwargs.get('epsilon_start', 1.0), kwargs.get('epsilon_end', 0.1), kwargs.get('epsilon_decay_steps', 20000)
        self.epsilons = np.linspace(epsilon_start, epsilon_end, epsilon_decay_steps)
        self.epsilon_decay_steps = epsilon_decay_steps
        self.q_net = GNN_Q_Net(self.num_node_features, num_actions).to(device)
        self.target_net = GNN_Q_Net(self.num_node_features, num_actions).to(device)
        self.optimizer = torch.optim.Adam(self.q_net.parameters(), lr=kwargs.get('learning_rate', 0.00005))
        self.target_net.load_state_dict(self.q_net.state_dict())
    
    def feed(self, ts):
        self.replay_memory.append(ts)
        self.step_counter += 1
        if self.step_counter % self.update_target_every == 0: self.target_net.load_state_dict(self.q_net.state_dict())
        if len(self.replay_memory) >= self.batch_size: self.train()

    def step(self, state):
        current_epsilon = self.epsilons[min(self.step_counter, self.epsilon_decay_steps-1)]
        if np.random.rand() < current_epsilon: return np.random.choice(list(state['legal_actions'].keys()))
        return self.eval_step(state)

    def eval_step(self, state):
        q_values = self.predict(state)
        legal_actions = list(state['legal_actions'].keys())
        masked_q_values = np.full(self.num_actions, -np.inf)
        masked_q_values[legal_actions] = q_values[legal_actions]
        return np.argmax(masked_q_values)

    def predict(self, state):
        graph_data = convert_state_to_graph(state, self.num_players, self.num_node_features)
        loader = DataLoader([graph_data], batch_size=1)
        batched_graph = next(iter(loader)).to(self.device)
        with torch.no_grad(): q_values_batch = self.q_net(batched_graph)
        return q_values_batch[0].cpu().numpy()

    def train(self):
        samples = random.sample(self.replay_memory, self.batch_size)
        state_batch, action_batch, reward_batch, next_state_batch, done_batch = map(list, zip(*samples))
        graph_batch = [convert_state_to_graph(s, self.num_players, self.num_node_features) for s in state_batch]
        next_graph_batch = [convert_state_to_graph(s, self.num_players, self.num_node_features) for s in next_state_batch]
        loader, next_loader = DataLoader(graph_batch, batch_size=self.batch_size), DataLoader(next_graph_batch, batch_size=self.batch_size)
        graph_batch, next_graph_batch = next(iter(loader)).to(self.device), next(iter(next_loader)).to(self.device)
        with torch.no_grad(): next_q_values = self.target_net(next_graph_batch)
        target_q = torch.tensor(reward_batch, dtype=torch.float32, device=self.device) + (1.0 - torch.tensor(done_batch, dtype=torch.float32, device=self.device)) * self.discount_factor * torch.max(next_q_values, dim=1)[0]
        q_values = self.q_net(graph_batch)
        action_tensor = torch.tensor(action_batch, dtype=torch.long, device=self.device).unsqueeze(1)
        predicted_q = q_values.gather(1, action_tensor).squeeze()
        loss = F.smooth_l1_loss(predicted_q, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()

    def save_model(self, path):
        torch.save(self.q_net.state_dict(), path)

if __name__ == '__main__':
    env = KuhnPokerGame()
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    set_seed(42)
    agent = StandaloneGnnAgent(num_actions=env.num_actions, state_shape=env.state_shape, num_players=env.num_players, device=device)
    env.agents = [agent, agent, agent]
    print("============= GNN Agent Self-Play Training Start =============")
    for episode in range(200000):
        state, player_id = env.init_game()
        while True:
            action = env.agents[player_id].step(state)
            next_state, reward, done = env.step(action)
            env.agents[player_id].feed((state, action, reward, next_state, done))
            state = next_state
            player_id = env.get_player_id()
            if done: break
        if episode % 1000 == 0: print(f"Episode {episode} finished.")
    print("\n============= Training Finished =============")
    
    agent.save_model('gnn_chipev_model.pth')
    print("Model has been saved to gnn_selfplay_model.pth")