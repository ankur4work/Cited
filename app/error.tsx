'use client';

import { useEffect } from 'react';

/**
 * What a merchant sees when a client component throws.
 *
 * Without this file Next renders its own fallback: "Application error: a
 * client-side exception has occurred (see the browser console for more
 * information)". That sentence is the whole problem — it tells the person
 * holding the broken screen to open a console they have never opened, and it
 * reaches us as a screenshot with nothing in it. A merchant will not open
 * devtools; they will uninstall.
 *
 * So the error itself goes on the page. `digest` is the id Next puts in the
 * SERVER log for the same failure, which is what makes a screenshot and a log
 * line joinable — without it, matching a report to a log entry is guesswork.
 *
 * Deliberately plain HTML and inline styles: this boundary catches failures in
 * the Polaris tree, so anything it renders must not depend on that tree having
 * mounted. A broken error page is worse than no error page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Also to the browser console, for anyone who does open it, and with the
    // digest attached so it lines up with the server side.
    console.error('[cited] client error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        maxWidth: '40rem',
        margin: '3rem auto',
        padding: '1.5rem',
        border: '1px solid #e1e3e5',
        borderRadius: '0.75rem',
        background: '#fff',
        color: '#202223',
      }}
    >
      <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
        Something in this page failed to load
      </h1>

      <p style={{ margin: '0 0 1rem', color: '#616161', lineHeight: 1.5 }}>
        Your reviews are safe — this is the admin screen, not your data. Try again, and if it
        keeps happening send us the details below.
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
        Try again
      </button>
    </div>
  );
}
