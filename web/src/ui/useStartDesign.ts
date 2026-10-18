import { useState } from 'react';
import { useLocation } from 'wouter';
import { createDesign } from '../api';
import { saveNow } from '../state/history';

/** Starts a Design (New, or Duplicate of one) and opens it in the editor (spec §10.8). */
export function useStartDesign() {
  const [, navigate] = useLocation();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  async function start(from: { scanId: string } | { duplicateOf: string }) {
    setStarting(true);
    setError(undefined);
    try {
      await saveNow();   // Duplicate copies the saved Design, so its latest change goes first
      navigate(`/d/${(await createDesign(from)).id}`);
    } catch (err) {
      const what = 'duplicateOf' in from ? 'duplicate this Design' : 'start a Design';
      setError(`Could not ${what} (${(err as Error).message}). Check that the API server is running, then try again.`);
    } finally {
      setStarting(false);
    }
  }

  return { start, starting, error };
}
