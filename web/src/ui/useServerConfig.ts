import { useEffect, useState } from 'react';
import { loadConfig, type ServerConfig } from '../api';

/** What the server offers (#42), or null until it has answered. */
export function useServerConfig() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);
  return config;
}
