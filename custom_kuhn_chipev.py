import numpy as np
import random

class KuhnPokerPlayer:
    def __init__(self, player_id):
        self.player_id = player_id
        self.hand = None
        self.status = 'playing'
        self.bet_in_round = 0

class KuhnPokerRound:
    def __init__(self, players):
        self.players = players
        self.pot = 0
        self.current_player_idx = 0
        self.is_over = False
        self.last_raiser = None
        self.raise_count = 0
        self.max_raises = 2
        self.amount_to_call = 0
        self.players_acted_this_street = {p.player_id for p in self.players}

    def get_current_player(self):
        return self.players[self.current_player_idx]

    def _advance_turn(self):
        self.current_player_idx = (self.current_player_idx + 1) % len(self.players)
        while self.players[self.current_player_idx].status != 'playing':
            if self.is_over: return
            self.current_player_idx = (self.current_player_idx + 1) % len(self.players)

    def proceed_round(self, action):
        player = self.get_current_player()
        if player.player_id in self.players_acted_this_street:
            self.players_acted_this_street.remove(player.player_id)
        if action == 'fold': player.status = 'folded'
        elif action == 'call':
            amount = self.amount_to_call - player.bet_in_round
            player.bet_in_round += amount
            self.pot += amount
        elif action == 'bet':
            bet_amount = 2
            player.bet_in_round += bet_amount
            self.pot += bet_amount
            self.amount_to_call = bet_amount
            self.last_raiser = player.player_id
            self.players_acted_this_street = {p.player_id for p in self.players if p.status == 'playing' and p.player_id != player.player_id}
        elif action == 'raise':
            total_bet = self.amount_to_call + 2
            amount_to_raise = total_bet - player.bet_in_round
            player.bet_in_round += amount_to_raise
            self.pot += amount_to_raise
            self.amount_to_call = total_bet
            self.raise_count += 1
            self.last_raiser = player.player_id
            self.players_acted_this_street = {p.player_id for p in self.players if p.status == 'playing' and p.player_id != player.player_id}
        num_playing = sum(1 for p in self.players if p.status == 'playing')
        if num_playing <= 1 or not self.players_acted_this_street: self.is_over = True
        if not self.is_over: self._advance_turn()

    def get_payoffs(self):
        payoffs = np.zeros(len(self.players))
        active_players = [p for p in self.players if p.status != 'folded']
        if not active_players:
            for p in self.players: payoffs[p.player_id] = -p.bet_in_round
            return payoffs
        if len(active_players) == 1: winner = active_players[0]
        else:
            best_hand = max(p.hand for p in active_players)
            winners = [p for p in active_players if p.hand == best_hand]
            winner = random.choice(winners)
        for p in self.players:
            if p.player_id == winner.player_id: payoffs[p.player_id] = self.pot - p.bet_in_round
            else: payoffs[p.player_id] = -p.bet_in_round
        return payoffs

class KuhnPokerGame:
    def __init__(self):
        self.num_players = 3
        self.num_actions = 5
        self.action_map = {0: 'fold', 1: 'check', 2: 'call', 3: 'bet', 4: 'raise'}
        self.state_shape = [[9]]
        self.equity_map = {0: 0.0, 1: 0.1, 2: 0.3, 3: 0.5, 4: 1.0}
        self.agents = None

    def init_game(self):
        self.players = [KuhnPokerPlayer(i) for i in range(self.num_players)]
        deck = [0, 1, 2, 3, 4]
        np.random.shuffle(deck)
        hands_to_deal = deck[:self.num_players]
        for i in range(self.num_players): self.players[i].hand = hands_to_deal[i]
        self.round = KuhnPokerRound(self.players)
        return self.get_state(0), 0

    def step(self, action):
        player_id = self.get_player_id()
        action_str = self.action_map[action]
        self.round.proceed_round(action_str)
        done = self.is_over()
        payoff = 0
        if done:
            payoffs = self.round.get_payoffs()
            payoff = payoffs[player_id]
        return self.get_state(self.get_player_id()), payoff, done

    def get_player_id(self):
        return self.round.current_player_idx

    def get_state(self, player_id):
        player = self.players[player_id]
        pot_size = self.round.pot
        amount_to_call = self.round.amount_to_call
        player_bets = [p.bet_in_round for p in self.players]
        hand_equity = self.equity_map.get(player.hand, 0)
        pot_odds_feature = amount_to_call / (pot_size + 1e-6)
        action_history_feature = 1 if self.round.last_raiser is not None else 0
        my_commitment_ratio = player.bet_in_round / (pot_size + 1e-6)
        obs = np.array([hand_equity, pot_size, amount_to_call] + player_bets + [pot_odds_feature, action_history_feature, my_commitment_ratio])
        legal_actions = {}
        if not self.is_over():
            if amount_to_call == 0:
                legal_actions[1] = None; legal_actions[3] = None
            else:
                legal_actions[2] = None
                if self.round.raise_count < self.round.max_raises: legal_actions[4] = None
            legal_actions[0] = None
        return {'obs': obs, 'legal_actions': legal_actions}

    def is_over(self):
        return self.round.is_over