'use client';

/**
 * Where a widget lands, drawn as the page it lands on.
 *
 * The cards used to show a thumbnail of the widget itself. That answers "what
 * does this look like" and leaves the question a merchant actually has —
 * "where does this go, and where is my product in relation to it?" — entirely
 * unanswered. Seven zoomed-in drawings gave no way to tell that three of them
 * belong on a product page and four do not.
 *
 * So this is a wireframe of the storefront page, with the product in its real
 * position and the widget's slot highlighted in its. Deliberately crude: grey
 * boxes for everything that is the theme's, one filled slot for what is ours.
 * A faithful rendering would compete with the real thing for attention and
 * would go stale the moment the block changed; a floor plan cannot.
 *
 * The appearance preview still exists — it lives in the customiser, where
 * colours and radius are what the merchant is actually choosing.
 */

/** Polaris' interactive blue. Reads as "this bit is the app" inside the admin. */
const SLOT = '#005BD3';
const SLOT_BG = 'rgba(0, 91, 211, 0.10)';
const GREY = '#E3E5E7';
const GREY_2 = '#C9CCD0';
const INK = '#8A8F94';

function Bar({
  w = '100%',
  h = 6,
  c = GREY,
  r = 3,
  mt = 0,
}: {
  w?: string | number;
  h?: number;
  c?: string;
  r?: number;
  mt?: number;
}) {
  return <div style={{ width: w, height: h, background: c, borderRadius: r, marginTop: mt }} />;
}

/** The highlighted region — the only thing on the diagram that is ours. */
function Slot({
  label,
  h,
  grid = false,
}: {
  label: string;
  h: number;
  /** Draw review cards inside, for the slots that are a grid of them. */
  grid?: boolean;
}) {
  return (
    <div
      style={{
        height: h,
        border: `1.5px solid ${SLOT}`,
        background: SLOT_BG,
        borderRadius: 4,
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontSize: 8,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: SLOT,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {grid && (
        <div style={{ display: 'flex', gap: 3, flex: 1, minHeight: 0 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                border: `1px solid ${SLOT}`,
                borderRadius: 2,
                opacity: 0.45,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** The theme's own chrome, identical on every diagram so the slot is what moves. */
function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        paddingBottom: 5,
        borderBottom: `1px solid ${GREY}`,
        marginBottom: 6,
      }}
    >
      <Bar w={14} h={5} c={GREY_2} />
      <Bar w={12} h={5} c={GREY} />
      <Bar w={10} h={5} c={GREY} />
      <div style={{ flex: 1 }}>{children}</div>
      <Bar w={5} h={5} c={GREY_2} r={999} />
      <Bar w={5} h={5} c={GREY_2} r={999} />
    </div>
  );
}

/**
 * The product page, above the fold: image left, the buy column right.
 * `slot` drops our block into that column, between the pieces it sits between.
 */
function ProductTop({ slot }: { slot?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <div
        style={{
          flex: '0 0 38%',
          background: GREY,
          borderRadius: 4,
          minHeight: 54,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Bar w="72%" h={7} c={GREY_2} />
        {slot}
        <Bar w="38%" h={6} />
        <div style={{ marginTop: 'auto' }}>
          <Bar h={11} c={GREY_2} r={4} />
        </div>
      </div>
    </div>
  );
}

function Caption({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        lineHeight: 1.3,
        color: INK,
        marginTop: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: 2, background: SLOT, flex: 'none' }}
        aria-hidden="true"
      />
      {text}
    </div>
  );
}

export function WidgetPlacement({ id }: { id: string }) {
  let inner: React.ReactNode;
  let caption: string;

  switch (id) {
    // In the buy column, between the title and the price.
    case 'star-rating':
      inner = (
        <>
          <Header />
          <ProductTop slot={<Slot label="Rating" h={16} />} />
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Bar w="45%" h={6} />
            <Bar h={5} />
          </div>
        </>
      );
      caption = 'In the buy column, under the product title';
      break;

    // Same column, lower — beside the button, where hesitation happens.
    case 'review-snippet':
      inner = (
        <>
          <Header />
          <ProductTop slot={<Slot label="Quote" h={24} />} />
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Bar w="45%" h={6} />
            <Bar h={5} />
          </div>
        </>
      );
      caption = 'In the buy column, next to Add to cart';
      break;

    // Full width, below the product. The band is what the merchant drags.
    case 'review-display':
      inner = (
        <>
          <Header />
          <ProductTop />
          <div style={{ marginTop: 6 }}>
            <Slot label="All reviews" h={44} grid />
          </div>
        </>
      );
      caption = 'Full width, below the product';
      break;

    // A home page: hero, then our band, then whatever else the theme has.
    case 'review-carousel':
    case 'testimonials':
      inner = (
        <>
          <Header />
          <div style={{ background: GREY, borderRadius: 4, height: 34 }} />
          <div style={{ marginTop: 6 }}>
            <Slot label={id === 'testimonials' ? 'Testimonials' : 'Carousel'} h={38} grid />
          </div>
          <div style={{ marginTop: 6 }}>
            <Bar h={8} />
          </div>
        </>
      );
      caption = 'Full width, on your home page';
      break;

    // Small enough to live in the header itself.
    case 'review-counter':
      inner = (
        <>
          <Header>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: 52 }}>
                <Slot label="4.8 ★" h={14} />
              </div>
            </div>
          </Header>
          <div style={{ background: GREY, borderRadius: 4, height: 40 }} />
          <div style={{ marginTop: 6, display: 'flex', gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ flex: 1, height: 26, background: GREY, borderRadius: 4 }} />
            ))}
          </div>
        </>
      );
      caption = 'In the header, the footer, or beside a hero';
      break;

    // A page of its own — the slot is the page.
    case 'review-page':
      inner = (
        <>
          <Header />
          <Bar w="50%" h={8} c={GREY_2} />
          <div style={{ marginTop: 6 }}>
            <Slot label="Every review" h={62} grid />
          </div>
        </>
      );
      caption = 'A page of its own, from any page template';
      break;

    // Both slots at once, and nothing to place — that is the whole point of it.
    case 'auto-embed':
    default:
      inner = (
        <>
          <Header />
          <ProductTop slot={<Slot label="Rating" h={14} />} />
          <div style={{ marginTop: 6 }}>
            <Slot label="All reviews" h={30} grid />
          </div>
        </>
      );
      caption = 'Both places, on every product, automatically';
      break;
  }

  return (
    <div>
      <div
        style={{
          border: `1px solid ${GREY}`,
          borderRadius: 8,
          background: '#FFFFFF',
          padding: 8,
          // Fixed, so every card in the grid keeps the same height — and the
          // diagrams are drawn to fit it rather than being clipped by it,
          // which is what made the old thumbnails read as broken images.
          height: 150,
          overflow: 'hidden',
        }}
      >
        {inner}
      </div>
      <Caption text={caption} />
    </div>
  );
}
