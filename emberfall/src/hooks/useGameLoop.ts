import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { flushSave, gameConfig, useGameStore } from '../store/gameStore';

/**
 * Drives the engine.
 *
 * This hook contains no game logic — it only decides *when* the engine runs and
 * supplies the wall clock the engine refuses to read for itself. Everything it
 * calls is a store action, which in turn calls a pure engine function.
 *
 * Returning to the foreground advances immediately rather than waiting for the
 * next interval, so the offline gap is measured from the real timestamp; going
 * to the background flushes the throttled save.
 */
export function useGameLoop(): void {
  const advanceTo = useGameStore((store) => store.advanceTo);

  useEffect(() => {
    advanceTo(Date.now());
    const interval = setInterval(() => {
      advanceTo(Date.now());
    }, gameConfig.time.tickIntervalMs);

    const onAppStateChange = (status: AppStateStatus): void => {
      if (status === 'active') {
        advanceTo(Date.now());
      } else {
        // The interval stops firing in the background; persist what we have
        // before the OS is free to kill the process.
        advanceTo(Date.now());
        flushSave();
      }
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      clearInterval(interval);
      subscription.remove();
      flushSave();
    };
  }, [advanceTo]);
}
