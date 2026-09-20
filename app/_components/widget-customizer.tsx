'use client';

import { useCallback, useState } from 'react';
import {
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Collapsible,
  Divider,
  Modal,
  RangeSlider,
  Text,
  TextField,
} from '@shopify/polaris';
import { showToast } from './toast';
import type { WidgetSettings } from '@/lib/widgets/settings';

/**
 * Colour input.
 *
 * Polaris ships a ColorPicker that works in HSB and returns no hex, so using
 * it here would mean converting in both directions to store the hex the
 * storefront needs. A native `<input type="color">` beside a text field gives
 * the picker for free, keeps hex as the only representation, and lets someone
 * paste a brand colour they already know.
 */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm">
        {label}
      </Text>
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <input
          type="color"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          style={{
            width: 36,
            height: 36,
            padding: 0,
            border: '1px solid #c9cccf',
            borderRadius: 8,
            background: 'none',
            cursor: 'pointer',
            flex: 'none',
          }}
        />
        <div style={{ flex: 1 }}>
          <TextField
            label={label}
            labelHidden
            value={value}
            autoComplete="off"
            maxLength={7}
            onChange={(v) => onChange(v.toUpperCase())}
          />
        </div>
      </InlineStack>
    </BlockStack>
  );
}


/**
 * One collapsible group.
 *
 * The customiser covers colours, shape, copy and selection rules; flat, that is
 * a wall of twenty controls and a merchant changing a button label scrolls past
 * everything else to reach it. Only one section is open at a time, so the list
 * of headings stays visible as a map of what can be changed.
 */
function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <BlockStack gap="200">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span>
          <Text as="span" variant="headingSm">
            {title}
          </Text>
          <br />
          <Text as="span" variant="bodySm" tone="subdued">
            {summary}
          </Text>
        </span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRight: '2px solid currentColor',
            borderBottom: '2px solid currentColor',
            transform: open ? 'rotate(-135deg)' : 'rotate(-45deg)',
            transition: 'transform 120ms ease',
            flex: 'none',
          }}
        />
      </button>
      <Collapsible open={open} id={`cited-section-${title}`} transition={false}>
        <BlockStack gap="300">{children}</BlockStack>
        <div style={{ height: 12 }} />
      </Collapsible>
      <Divider />
    </BlockStack>
  );
}

/** A live preview, built from the same values the storefront will use. */
function Preview({ s }: { s: WidgetSettings }) {
  const star = (filled: boolean) => (
    <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
      <path
        d="M10 1.6l2.6 5.2 5.8.85-4.2 4.1 1 5.75L10 14.8l-5.2 2.7 1-5.75L1.6 7.65l5.8-.85z"
        fill={filled ? s.starColor : s.borderColor}
      />
    </svg>
  );

  return (
    <div
      style={{
        border: `1px solid ${s.borderColor}`,
        borderRadius: s.cornerRadius,
        padding: s.spacing,
        color: s.textColor,
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{s.heading}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <strong>4.5</strong>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i}>{star(i <= 4)}</span>
        ))}
        <span style={{ color: s.mutedColor, fontSize: 13 }}>2 reviews</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i}>{star(i <= 5)}</span>
        ))}
        <strong style={{ fontSize: 13 }}>Exactly as described</strong>
      </div>
      <div style={{ color: s.mutedColor, fontSize: 12, marginTop: 2 }}>
        Reviewed on 12 September 2026 · Verified purchase
      </div>
      <div style={{ marginTop: 6, lineHeight: 1.5 }}>
        Arrived faster than expected and the fit is spot on.
      </div>
      <div style={{ color: s.mutedColor, fontSize: 12, marginTop: 10 }}>
        — {s.anonymousLabel}
      </div>
    </div>
  );
}

export function WidgetCustomizer({ initial }: { initial: WidgetSettings }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<WidgetSettings>(initial);
  const [saving, setSaving] = useState(false);
  // One at a time. Every section open at once is the flat wall this replaced.
  const [section, setSection] = useState<string | null>('colors');
  const toggle = (id: string) => setSection((cur) => (cur === id ? null : id));

  const set = useCallback(
    <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) =>
      setS((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const idToken = await window.shopify?.idToken?.();
      if (!idToken) throw new Error('not authenticated');

      const res = await fetch('/api/widgets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `request failed (${res.status})`);
      }
      showToast('Widgets updated');
      setOpen(false);
    } catch (err) {
      showToast((err as Error).message, { isError: true });
    } finally {
      setSaving(false);
    }
  }, [s]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Customize</Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Customize widgets"
        primaryAction={{ content: 'Save', onAction: () => void save(), loading: saving }}
        secondaryActions={[
          {
            content: 'Reset',
            onAction: () => setS(initial),
            disabled: saving,
          },
          { content: 'Cancel', onAction: () => setOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            <Text as="p" variant="bodySm" tone="subdued">
              These apply to every Cited widget on your storefront, so the rating beside your price
              and the reviews below it always match.
            </Text>

            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Preview
                </Text>
                <Preview s={s} />
              </BlockStack>
            </Card>

            <Section
              title="Color schemes"
              summary="Stars, text and borders across every widget"
              open={section === 'colors'}
              onToggle={() => toggle('colors')}
            >
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <ColorField label="Stars" value={s.starColor} onChange={(v) => set('starColor', v)} />
                <ColorField label="Text" value={s.textColor} onChange={(v) => set('textColor', v)} />
                <ColorField
                  label="Secondary text"
                  value={s.mutedColor}
                  onChange={(v) => set('mutedColor', v)}
                />
                <ColorField
                  label="Borders"
                  value={s.borderColor}
                  onChange={(v) => set('borderColor', v)}
                />
              </InlineGrid>
            </Section>

            <Section
              title="Review item layout"
              summary="Corner radius and spacing"
              open={section === 'layout'}
              onToggle={() => toggle('layout')}
            >
              <RangeSlider
                label="Corner radius"
                value={s.cornerRadius}
                min={0}
                max={24}
                step={2}
                suffix={`${s.cornerRadius}px`}
                onChange={(v) => set('cornerRadius', Number(v))}
              />
              <RangeSlider
                label="Spacing"
                value={s.spacing}
                min={8}
                max={40}
                step={2}
                suffix={`${s.spacing}px`}
                onChange={(v) => set('spacing', Number(v))}
              />
            </Section>

            <Section
              title="Review selection rules"
              summary="How many quotes the snippet shows"
              open={section === 'selection'}
              onToggle={() => toggle('selection')}
            >
              <RangeSlider
                label="Quotes in the Review Snippet"
                value={s.snippetQuotes}
                min={1}
                max={3}
                step={1}
                suffix={`${s.snippetQuotes}`}
                onChange={(v) => set('snippetQuotes', Number(v))}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                Carousel and testimonial widgets show reviews rated 4 or better that actually have
                text, most helpful first. Their count is set on the block itself, since one store
                can run several.
              </Text>
            </Section>

            <Section
              title="Title"
              summary="Headings shown above your reviews"
              open={section === 'title'}
              onToggle={() => toggle('title')}
            >
              <TextField
                label="Heading"
                value={s.heading}
                autoComplete="off"
                maxLength={120}
                onChange={(v) => set('heading', v)}
              />
              <TextField
                label="Write-a-review heading"
                value={s.formHeading}
                autoComplete="off"
                maxLength={120}
                onChange={(v) => set('formHeading', v)}
              />
            </Section>

            <Section
              title="Card content"
              summary="Wording inside each review"
              open={section === 'content'}
              onToggle={() => toggle('content')}
            >
              <TextField
                label="Shown when a product has no reviews"
                value={s.emptyText}
                autoComplete="off"
                maxLength={200}
                onChange={(v) => set('emptyText', v)}
              />
              <TextField
                label="Name shown when a reviewer gave none"
                value={s.anonymousLabel}
                autoComplete="off"
                maxLength={120}
                onChange={(v) => set('anonymousLabel', v)}
              />
              <TextField
                label="Submit button"
                value={s.formButton}
                autoComplete="off"
                maxLength={40}
                onChange={(v) => set('formButton', v)}
              />
            </Section>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
