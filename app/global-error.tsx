'use client';

/**
 * The boundary of last resort: a throw in the root layout itself, which
 * `app/error.tsx` cannot catch because it renders INSIDE that layout.
 *
 * Next replaces the whole document here, so this file has to supply its own
 * <html> and <body> — and, like the boundary beside it, nothing it renders may
 * depend on the app's providers, since the reason we are here is that they did
 * not mount.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: '3rem 1.5rem',
          background: '#f6f6f7',
          color: '#202223',
        }}
      >
        <div
          style={{
            maxWidth: '40rem',
            margin: '0 auto',
            padding: '1.5rem',
            background: '#fff',
            border: '1px solid #e1e3e5',
            borderRadius: '0.75rem',
          }}
        >
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            Cited could not start
          </h1>
          <p style={{ margin: '0 0 1rem', color: '#616161', lineHeight: 1.5 }}>
            Your reviews and settings are unaffected. Reload to try again.
          </p>
          <p
            style={{
              margin: '0 0 1rem',
              padding: '0.75rem',
              background: '#f6f6f7',
              borderRadius: '0.5rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.8125rem',
              wordBreak: 'break-word',
            }}
          >
            {error.message || 'No message was attached to this error.'}
            {error.digest ? (
              <>
                <br />
                <span style={{ color: '#616161' }}>Reference: {error.digest}</span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#202223',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
