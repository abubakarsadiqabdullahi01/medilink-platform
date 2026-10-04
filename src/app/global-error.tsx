'use client';

import { useEffect } from 'react';

/**
 * The last resort: the root layout itself threw.
 *
 * It replaces the whole document, so it must render its own `<html>` and
 * `<body>` and cannot use anything from the layout it is standing in for —
 * no providers, no theme, no component library. The styling is inline for
 * that reason rather than out of haste: globals.css is loaded by the layout
 * that has just failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-NG">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#fafaf9',
          color: '#1c1917',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Medilink did not start</h1>
          <p style={{ marginTop: '0.75rem', lineHeight: 1.6, color: '#57534e' }}>
            Something failed before the page could be built. Nothing you were working on has been
            changed.
          </p>

          {error.digest ? (
            <p style={{ marginTop: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#78716c' }}>
              Reference {error.digest}
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.6rem 1.1rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#01696f',
              color: '#ffffff',
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
