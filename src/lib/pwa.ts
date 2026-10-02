import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const UPDATED_FLAG = 'troskovi.updated';

/**
 * Keeps the installed app on the newest version. Phones resume apps from the
 * background instead of reloading them, so we look for a new version every time
 * the app comes back to the screen, and switch to it as soon as nobody is in the
 * middle of entering something.
 */
export function useAutoUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', check);
      setInterval(check, 30 * 60 * 1000);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    const timer = setInterval(() => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (typing || document.querySelector('.sheet')) return;
      clearInterval(timer);
      try {
        sessionStorage.setItem(UPDATED_FLAG, '1');
      } catch {
        /* ignore */
      }
      updateServiceWorker(true); // reloads the page
    }, 1000);
    return () => clearInterval(timer);
  }, [needRefresh, updateServiceWorker]);
}

/** True once, right after the app reloaded itself into a new version. */
export function takeUpdatedFlag(): boolean {
  try {
    if (!sessionStorage.getItem(UPDATED_FLAG)) return false;
    sessionStorage.removeItem(UPDATED_FLAG);
    return true;
  } catch {
    return false;
  }
}

declare const __BUILD_TIME__: string;
/** When this version of the app was built (shown in Settings). */
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
