'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Icon,
  InlineStack,
  Listbox,
  Modal,
  Popover,
  Select,
  Spinner,
  Text,
} from '@shopify/polaris';
import {
  BlogIcon,
  CartIcon,
  CheckCircleIcon,
  CollectionIcon,
  CollectionListIcon,
  ExternalIcon,
  HomeIcon,
  PageIcon,
  ProductIcon,
  SearchIcon,
  ThemeTemplateIcon,
} from '@shopify/polaris-icons';
import type { WidgetDef } from '@/lib/shopify/widgets';
import type { ThemeSummary } from '@/lib/shopify/themes';
import { suggestTemplate, type TemplateIcon } from '@/lib/shopify/templates';
import { showToast } from './toast';

const ICONS: Record<TemplateIcon, typeof HomeIcon> = {
  home: HomeIcon,
  product: ProductIcon,
  collection: CollectionIcon,
  'collection-list': CollectionListIcon,
  cart: CartIcon,
  page: PageIcon,
  blog: BlogIcon,
  search: SearchIcon,
  template: ThemeTemplateIcon,
};

/**
 * A select-shaped button that opens a list with icons.
 *
 * Polaris `Select` is a native `<select>`, which can hold text and nothing
 * else — and a list of twenty template names with no glyphs is the thing this
 * dialog exists to avoid, because "promotions" and "about-us" read alike until
 * you can see that one is a product template and the other is a page.
 */
function PagePicker({
  templates,
  value,
  onChange,
  suggested,
}: {
  templates: ThemeSummary['templates'];
  value: string;
  onChange: (key: string) => void;
  suggested?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = templates.find((t) => t.key === value);

  const activator = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-haspopup="listbox"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        minHeight: 32,
        padding: '6px 12px',
        background: 'var(--p-color-bg-surface)',
        border: '1px solid var(--p-color-border)',
        borderRadius: 'var(--p-border-radius-200)',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: 'var(--p-color-text)',
      }}
    >
      {selected ? (
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Icon source={ICONS[selected.icon]} tone="base" />
          <Text as="span">{selected.label}</Text>
        </InlineStack>
      ) : (
        <Text as="span" tone="subdued">
          Select a page
        </Text>
      )}
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          marginBottom: 3,
          borderRight: '1.5px solid currentColor',
          borderBottom: '1.5px solid currentColor',
          transform: 'rotate(45deg)',
          flex: 'none',
          opacity: 0.6,
        }}
      />
    </button>
  );

  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodyMd">
        Page to display
      </Text>
      <Popover active={open} activator={activator} onClose={() => setOpen(false)} fullWidth>
        {/*
          Capped and scrollable. A theme with a dozen alternate product
          templates otherwise produces a list taller than the dialog, and the
          Add widget button goes off the bottom of the screen.
        */}
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <Listbox
            onSelect={(key) => {
              onChange(key);
              setOpen(false);
            }}
          >
            {templates.map((t) => (
              <Listbox.Option
                key={t.key}
                value={t.key}
                selected={t.key === value}
                accessibilityLabel={t.label}
              >
                <Listbox.TextOption selected={t.key === value}>
                  <InlineStack gap="300" blockAlign="center" wrap={false} align="space-between">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Icon source={ICONS[t.icon]} tone="base" />
                      <Text as="span">{t.label}</Text>
                    </InlineStack>
                    {t.key === suggested && <Badge tone="info">Suggested</Badge>}
                  </InlineStack>
                </Listbox.TextOption>
              </Listbox.Option>
            ))}
          </Listbox>
        </div>
      </Popover>
    </BlockStack>
  );
}

/** One row of the mock theme-editor sidebar in the quick guide. */
function MockRow({
  label,
  indent = 0,
  highlight = false,
}: {
  label: string;
  indent?: number;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: '5px 8px',
        paddingLeft: 8 + indent * 16,
        borderRadius: 6,
        background: highlight ? 'var(--p-color-bg-surface-secondary)' : 'transparent',
      }}
    >
      <Text as="span" variant="bodySm" tone={highlight ? 'base' : 'subdued'}>
        {label}
      </Text>
    </div>
  );
}

/**
 * What the merchant is about to see, drawn rather than screenshotted.
 *
 * A PNG of the theme editor would be a binary asset that names one widget and
 * goes stale the first time Shopify restyles the sidebar. This is built from
 * the same widget name the dialog was opened on, so the picture and the button
 * always agree.
 */
function QuickGuide({ widgetName }: { widgetName: string }) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingSm">
          Quick guide
        </Text>

        <BlockStack gap="200">
          {[
            'Select the page where you want to display the widget',
            'Click the “Add widget” button below',
            'The Shopify theme editor opens, and the widget is added automatically',
            'Click “Save” in the top-right corner to apply the changes',
          ].map((step, i) => (
            <InlineStack key={step} gap="300" blockAlign="start" wrap={false}>
              <span
                aria-hidden="true"
                style={{
                  flex: 'none',
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: 'var(--p-color-bg-surface-secondary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <Text as="span" variant="bodySm">
                {step}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>

        <Box borderWidth="025" borderColor="border" borderRadius="200" padding="300">
          <InlineStack gap="400" blockAlign="start" wrap={false}>
            <div style={{ flex: '1 1 40%', minWidth: 0 }}>
              <MockRow label="Buttons" indent={1} />
              <MockRow label="Featured collection" indent={1} />
              <MockRow label="Apps" />
              <MockRow label={widgetName} indent={1} highlight />
              <MockRow label="Add section" indent={1} />
              <MockRow label="Footer" />
            </div>
            <div style={{ flex: '1 1 60%', minWidth: 0 }}>
              <Box
                background="bg-surface"
                borderWidth="025"
                borderColor="border"
                borderRadius="200"
                padding="300"
                shadow="200"
              >
                <BlockStack gap="200">
                  <InlineStack gap="150" blockAlign="center" wrap={false}>
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      “{widgetName}” added
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Drag the “Apps” section up or down to move it to the position you want. When
                    ready, save your changes.
                  </Text>
                </BlockStack>
              </Box>
            </div>
          </InlineStack>
        </Box>
      </BlockStack>
    </Card>
  );
}

export function AddWidgetModal({
  widget,
  shopDomain,
  /** Used when themes cannot be read — the live theme and the widget's own template. */
  fallbackUrl,
  /** Where “turn on automatic placement” goes for a theme that takes no app blocks. */
  embedUrl,
  buildUrl,
}: {
  widget: WidgetDef;
  shopDomain: string;
  fallbackUrl: string;
  embedUrl?: string;
  /** Injected so the URL is built by the same function the tests cover. */
  buildUrl: (opts: { themeId: string; template: string }) => string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // null = not loaded yet; [] = loaded and there is nothing we can read.
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [themeId, setThemeId] = useState('');
  const [template, setTemplate] = useState('');
  const [instructions, setInstructions] = useState(false);

  const theme = themes?.find((t) => t.id === themeId);

  // Only once per mount. A merchant who opens the dialog, cancels and reopens
  // is looking at a theme list that cannot have changed in between, and
  // refetching would put a spinner in front of a dialog they have already read.
  useEffect(() => {
    if (!open || themes !== null || loading) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const idToken = await window.shopify?.idToken?.();
        if (!idToken) throw new Error('not authenticated');

        const res = await fetch('/api/widgets/themes', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error(`could not load themes (${res.status})`);

        const body = (await res.json()) as { themes: ThemeSummary[] };
        if (cancelled) return;

        setThemes(body.themes);
        const live = body.themes.find((t) => t.live) ?? body.themes[0];
        if (live) setThemeId(live.id);
      } catch (err) {
        if (cancelled) return;
        // [] puts the dialog into its fallback, which still places the widget.
        // A toast here would be alarming about something the merchant can
        // still do.
        setThemes([]);
        showToast((err as Error).message, { isError: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, themes, loading]);

  // Switching theme has to clear the page: template keys are per-theme, and a
  // `page.faq` carried over from the old theme would deep-link to a template
  // the new one does not have.
  const pickTheme = useCallback(
    (id: string) => {
      setThemeId(id);
      setTemplate('');
    },
    [],
  );

  const suggested = theme
    ? suggestTemplate(theme.templates, widget.template ?? 'product')?.key
    : undefined;

  const go = useCallback(() => {
    const url = theme && template ? buildUrl({ themeId: theme.id, template }) : fallbackUrl;
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);
  }, [theme, template, buildUrl, fallbackUrl]);

  const loaded = themes !== null && !loading;
  const noThemes = loaded && themes.length === 0;
  const blocked = Boolean(theme && !theme.supportsAppBlocks);
  const canAdd = noThemes || (Boolean(template) && !blocked);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add widget
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Add ${widget.name}`}
        primaryAction={{
          content: 'Add widget',
          icon: ExternalIcon,
          onAction: go,
          disabled: !loaded || !canAdd,
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setOpen(false) }]}
      >
        <Modal.Section>
          {!loaded ? (
            <InlineStack gap="300" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Loading themes" />
              <Text as="span" tone="subdued">
                Reading your themes…
              </Text>
            </InlineStack>
          ) : (
            <BlockStack gap="500">
              {noThemes ? (
                <Banner tone="info" title="Open the theme editor">
                  <Text as="p" variant="bodySm">
                    Cited can’t read this store’s themes, so it can’t offer a page to place{' '}
                    {widget.name} on. The button below opens the theme editor on your live theme
                    with the widget ready to drop in.
                  </Text>
                </Banner>
              ) : (
                <>
                  <Select
                    label="Target theme"
                    options={themes.map((t) => ({
                      label: `Shopify theme ${t.name}${t.live ? ' (Live)' : ''}`,
                      value: t.id,
                    }))}
                    value={themeId}
                    onChange={pickTheme}
                    helpText={
                      theme?.supportsAppBlocks
                        ? 'Standard theme (Online Store 2.0)'
                        : 'Vintage theme — this one can’t hold app blocks'
                    }
                  />

                  {theme && theme.supportsAppBlocks && (
                    <PagePicker
                      templates={theme.templates}
                      value={template}
                      onChange={setTemplate}
                      suggested={suggested}
                    />
                  )}
                </>
              )}

              {blocked ? (
                <Banner tone="warning" title="This theme doesn’t support App Blocks">
                  <BlockStack gap="300">
                    <Text as="p" variant="bodySm">
                      {theme?.name} is a vintage theme, so there is nowhere in its templates for a
                      widget to go. Automatic placement works on any theme — it puts the rating
                      under your product title and the reviews below the product without a
                      placement step.
                    </Text>
                    {embedUrl && (
                      <InlineStack>
                        <Button url={embedUrl} target="_blank">
                          Turn on automatic placement
                        </Button>
                      </InlineStack>
                    )}
                  </BlockStack>
                </Banner>
              ) : (
                !noThemes && (
                  <Banner tone="info" title="Ready to install">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">
                        Your theme supports App Blocks. Click the button below to open the theme
                        editor and drag the widget exactly where you want it.
                      </Text>
                    </BlockStack>
                  </Banner>
                )
              )}

              {!blocked && (
                <BlockStack gap="300">
                  <InlineStack>
                    <Button
                      variant="plain"
                      disclosure={instructions ? 'up' : 'down'}
                      onClick={() => setInstructions((v) => !v)}
                    >
                      See instructions
                    </Button>
                  </InlineStack>
                  <Collapsible open={instructions} id={`cited-guide-${widget.id}`}>
                    <QuickGuide widgetName={widget.name} />
                  </Collapsible>
                </BlockStack>
              )}

              <Text as="p" variant="bodySm" tone="subdued">
                Opens {shopDomain}’s theme editor in a new tab. Cited never edits your theme — the
                placement is yours to make and to save.
              </Text>
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}
