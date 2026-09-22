'use client';

import type { CSSProperties } from 'react';
import type { WidgetSettings } from '@/lib/widgets/settings';

/**
 * What each widget looks like, drawn from the merchant's own settings.
 *
 * The cards on the Widgets page used to describe seven widgets in prose and
 * show none of them. "Your best reviews in a scrollable row" asks a merchant
 * to picture a layout before deciding whether to put it on their home page,
 * and the four page-level widgets are exactly the ones whose shape is hardest
 * to guess from a sentence.
 *
 * This is a DRAWING, not the storefront. The real blocks are Liquid rendered
 * inside the merchant's theme, in the theme's typeface, against the theme's
 * background — we could not reproduce that here without an iframe of their
 * storefront and a product that has reviews. What it is faithful about is the
 * two things a merchant is actually choosing between: the arrangement, and
 * their own colours, radius and spacing, which come from the same
 * WidgetSettings the blocks read. Sample copy is fixed and obviously sample.
 */

/** One review, reused across every shape so the previews agree with each other. */
interface Sample {
  rating: number;
  title: string;
  body: string;
  author: string;
  product: string;
}

// A fixed-length tuple, not Sample[]: the shapes below destructure it, and
// under noUncheckedIndexedAccess an array would hand each one Sample|undefined
// to null-check for data that is right here in the file.
const SAMPLES: [Sample, Sample, Sample] = [
  {
    rating: 5,
    title: 'Exactly as described',
    body: 'Arrived faster than expected and the fit is spot on.',
    author: 'Priya R.',
    product: 'Linen Shirt',
  },
  {
    rating: 5,
    title: 'Worth it',
    body: 'Second one I have bought. The colour has not faded at all.',
    author: 'Sam T.',
    product: 'Canvas Tote',
  },
  {
    rating: 4,
    title: 'Very good',
    body: 'Comfortable straight away. Slightly larger than I expected.',
    author: 'Jordan M.',
    product: 'Wool Runners',
  },
];

function Stars({ n, s, size = 13 }: { n: number; s: WidgetSettings; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1, lineHeight: 0 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
          <path
            d="M10 1.6l2.6 5.2 5.8.85-4.2 4.1 1 5.75L10 14.8l-5.2 2.7 1-5.75L1.6 7.65l5.8-.85z"
            fill={i <= n ? s.starColor : s.borderColor}
          />
        </svg>
      ))}
    </span>
  );
}

/** The frame every preview sits in: fixed height so a grid of cards stays even. */
function Frame({ s, children }: { s: WidgetSettings; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${s.borderColor}`,
        borderRadius: s.cornerRadius,
        // Scaled down from the real spacing: these are thumbnails, and a 40px
        // setting would leave no room for the content it is spacing.
        padding: Math.max(8, Math.round(s.spacing * 0.65)),
        color: s.textColor,
        background: '#FFFFFF',
        fontSize: 12,
        // 148 cut the Review Display drawing off mid-histogram, so its bottom
        // row and the foot of both review cards were sliced — which reads as a
        // broken image rather than as a preview that continues.
        height: 168,
        overflow: 'hidden',
        // The carousel and the page preview both run past the edge on purpose.
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
}

const muted = (s: WidgetSettings): CSSProperties => ({ color: s.mutedColor, fontSize: 11 });

function QuoteCard({ r, s, width }: { r: Sample; s: WidgetSettings; width: number }) {
  return (
    <div
      style={{
        flex: `0 0 ${width}px`,
        border: `1px solid ${s.borderColor}`,
        borderRadius: Math.min(s.cornerRadius, 10),
        padding: 8,
      }}
    >
      <Stars n={r.rating} s={s} size={11} />
      <div style={{ fontWeight: 600, marginTop: 4 }}>{r.title}</div>
      <div style={{ ...muted(s), marginTop: 2, lineHeight: 1.4 }}>{r.body.slice(0, 52)}…</div>
      <div style={{ ...muted(s), marginTop: 6 }}>— {r.author}</div>
    </div>
  );
}

export function WidgetPreview({ id, s }: { id: string; s: WidgetSettings }) {
  const [a, b, c] = SAMPLES;

  switch (id) {
    // Stars and a count, inline — what sits beside a price. Shown on its own
    // line here because a preview of a fragment needs something to sit against.
    case 'star-rating':
      return (
        <Frame s={s}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 34 }}>
            <Stars n={5} s={s} size={16} />
            <strong style={{ fontSize: 13 }}>4.8</strong>
            <span style={muted(s)}>· 128 reviews</span>
          </div>
          <div style={{ ...muted(s), marginTop: 10 }}>Sits beside your price or title.</div>
        </Frame>
      );

    // One or two short quotes near the buy button.
    case 'review-snippet':
      return (
        <Frame s={s}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Stars n={5} s={s} />
            <strong style={{ fontSize: 12 }}>4.8</strong>
            <span style={muted(s)}>128 reviews</span>
          </div>
          {SAMPLES.slice(0, Math.min(s.snippetQuotes, 2)).map((r) => (
            <div key={r.author} style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <div style={{ ...muted(s), lineHeight: 1.4 }}>{r.body.slice(0, 46)}…</div>
            </div>
          ))}
        </Frame>
      );

    // A scrollable row. The third card is deliberately clipped by the frame:
    // that overflow IS the widget, and a preview that fits everything neatly
    // would misrepresent it.
    case 'review-carousel':
      return (
        <Frame s={s}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.heading}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[a, b, c].map((r) => (
              <QuoteCard key={r.author} r={r} s={s} width={116} />
            ))}
          </div>
        </Frame>
      );

    // Fewer, larger, quieter. No thumbnails, no product names.
    case 'testimonials':
      return (
        <Frame s={s}>
          <div style={{ display: 'flex', gap: 14 }}>
            {[a, b].map((r) => (
              <div key={r.author} style={{ flex: 1 }}>
                <Stars n={r.rating} s={s} size={12} />
                <div style={{ marginTop: 6, lineHeight: 1.5, fontSize: 12 }}>“{r.body}”</div>
                <div style={{ ...muted(s), marginTop: 8 }}>{r.author}</div>
              </div>
            ))}
          </div>
        </Frame>
      );

    // One number, big. For a header, a footer or an About page.
    case 'review-counter':
      return (
        <Frame s={s}>
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>4.8</div>
            <div style={{ marginTop: 4 }}>
              <Stars n={5} s={s} size={15} />
            </div>
            <div style={{ ...muted(s), marginTop: 6 }}>from 128 reviews across the store</div>
          </div>
        </Frame>
      );

    // A whole page: heading, store-wide average, then reviews from every
    // product rather than one.
    case 'review-page':
      return (
        <Frame s={s}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>What customers say</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Stars n={5} s={s} size={12} />
            <span style={muted(s)}>4.8 · 128 reviews</span>
          </div>
          <div style={{ height: 1, background: s.borderColor, margin: '8px 0' }} />
          {[a, b].map((r) => (
            <div key={r.author} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Stars n={r.rating} s={s} size={10} />
                <strong style={{ fontSize: 11 }}>{r.title}</strong>
                <span style={muted(s)}>· {r.product}</span>
              </div>
              <div style={{ ...muted(s), marginTop: 1 }}>{r.body.slice(0, 54)}…</div>
            </div>
          ))}
        </Frame>
      );

    // The full list under a product, and the default for anything unrecognised
    // — a new widget id should draw something honest rather than nothing.
    //
    // Redrawn to match what the block actually renders. It showed a stacked
    // list with a small inline "4.8 ★★★★★ 128 reviews" line, which is what the
    // block looked like BEFORE the storefront redesign — so a merchant
    // comparing this card to their own product page saw two different widgets
    // and had no reason to trust either.
    case 'review-display':
    default:
      return (
        <Frame s={s}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{s.heading}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* The score as a headline, and the histogram under it. */}
            <div style={{ flex: '0 0 68px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>4.8</div>
              <div style={{ marginTop: 3 }}>
                <Stars n={5} s={s} size={10} />
              </div>
              <div style={{ ...muted(s), marginTop: 2, fontSize: 10 }}>128 Reviews</div>
              {/* Three rows, not five. The aside's job in a thumbnail is to
                * say "there is a histogram here", and five rows of 4px bar
                * pushed the cards beside them off the bottom of the frame. */}
              <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
                {[80, 20, 0].map((pct, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ ...muted(s), fontSize: 9, width: 6 }}>{5 - i}</span>
                    {/* A filled track even at 0% — the empty outlined boxes this
                      * replaced read as four broken widgets, not an empty row. */}
                    <span
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 999,
                        background: s.borderColor,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          width: `${pct}%`,
                          height: '100%',
                          background: s.starColor,
                        }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Filter chips and the card grid, which is the shape that changed. */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: s.textColor,
                    color: '#FFFFFF',
                    fontSize: 9,
                  }}
                >
                  All
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: `1px solid ${s.borderColor}`,
                    fontSize: 9,
                  }}
                >
                  With photos
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[a, b].map((r) => (
                  <div
                    key={r.author}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: `1px solid ${s.borderColor}`,
                      borderRadius: Math.min(s.cornerRadius, 10),
                      padding: 7,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 11 }}>{r.author}</div>
                    <div style={{ marginTop: 3 }}>
                      <Stars n={r.rating} s={s} size={10} />
                    </div>
                    {/* One line, ellipsised. "Exactly as described" wrapped to
                      * "Exactly as" over "described" in a card this narrow,
                      * which looked like truncated garbage rather than a
                      * headline. */}
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 10,
                        marginTop: 3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {r.title}
                    </div>
                    <div style={{ ...muted(s), marginTop: 2, fontSize: 10, lineHeight: 1.4 }}>
                      {r.body.slice(0, 32)}…
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Frame>
      );
  }
}
