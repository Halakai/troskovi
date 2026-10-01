// Tiny hash router: "#/history?cat=…" → path "/history", params { cat }.
// Hash URLs work on GitHub Pages without any server configuration.
import { useEffect, useState } from 'react';

function parse(): [string, URLSearchParams] {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return [path || '/', new URLSearchParams(query)];
}

export function useRoute(): [string, URLSearchParams] {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
}
