'use client';

import { useSyncExternalStore } from 'react';
import { CloudOff, Hourglass } from 'lucide-react';
import { describeConnection, type ConnectionState } from '@/lib/ui/connection';

interface NetworkInformation extends EventTarget {
  effectiveType?: string;
}

function connection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  const info = connection();
  info?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
    info?.removeEventListener('change', onChange);
  };
}

const read = (): ConnectionState =>
  describeConnection({ online: navigator.onLine, effectiveType: connection()?.effectiveType });

/** On the server nothing is known, and "ok" draws nothing, so the first paint is never a false alarm. */
const readOnServer = (): ConnectionState => 'ok';

/**
 * Says so when the connection is gone or slow, and nothing otherwise.
 *
 * Offline is the case that matters: what is on screen can still be read, but nothing will save, and a
 * person who is told so goes to find signal instead of pressing the same button again. Coming back
 * online needs no message — the queries refetch by themselves and the banner simply goes.
 *
 * A polite live region, not an alert: it is information, and an interruption mid-sentence in a screen
 * reader is the wrong way to deliver it.
 */
export function NetworkBanner() {
  const state = useSyncExternalStore(subscribe, read, readOnServer);
  if (state === 'ok') return null;

  const Icon = state === 'offline' ? CloudOff : Hourglass;
  return (
    <div
      role="status"
      className={
        state === 'offline'
          ? 'mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm'
          : 'mb-4 flex items-start gap-3 rounded-lg border border-info/30 bg-info/5 px-4 py-3 text-sm'
      }
    >
      <Icon
        className={state === 'offline' ? 'mt-0.5 size-5 shrink-0 text-warning' : 'mt-0.5 size-5 shrink-0 text-info'}
        aria-hidden="true"
      />
      <p className="leading-relaxed">
        {state === 'offline' ? (
          <>
            <strong>You are offline.</strong> What is on the screen can still be read, but nothing can be
            saved until you are back. Move to where there is signal; this page will refresh itself.
          </>
        ) : (
          <>
            <strong>Your connection is slow.</strong> Pages may take a while to load. If something seems
            stuck, wait a moment before pressing it again.
          </>
        )}
      </p>
    </div>
  );
}
