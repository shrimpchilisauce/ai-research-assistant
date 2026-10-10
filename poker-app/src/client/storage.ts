/** localStorage は使えない環境（プライベートモードなど）もあるので、失敗しても動くようにする。 */

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても続行する
  }
}

export const storage = {
  token: (roomId: string) => get(`poker:token:${roomId}`),
  setToken: (roomId: string, token: string) => set(`poker:token:${roomId}`, token),
  name: () => get('poker:name') ?? '',
  setName: (name: string) => set('poker:name', name),
  muted: () => get('poker:muted') === '1',
  setMuted: (muted: boolean) => set('poker:muted', muted ? '1' : '0'),
};
