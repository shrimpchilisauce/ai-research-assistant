import { useCallback, useEffect, useState } from 'react';
import { Home } from './components/Home';
import { RoomPage } from './components/RoomPage';

export function App() {
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    history.pushState(null, '', to);
    setPath(to);
  }, []);

  const room = path.match(/^\/r\/([A-Za-z0-9]{10})\/?$/);
  if (room) return <RoomPage key={room[1]} roomId={room[1]} navigate={navigate} />;
  return <Home navigate={navigate} />;
}
