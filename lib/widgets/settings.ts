import { z } from 'zod';

/**
 * Widget appearance and copy, edited in the app rather than the theme editor.
 *
 * ONE source of truth, deliberately. These values used to be block settings,
 * which meant every theme, every template and every duplicated block carried
 * its own copy — a merchant who changed their star colour changed it in one
 * place and wondered why the rating beside the price stayed yellow. They now
 * live on the shop and every Cited block reads the same record.
 *
 * Stored as an app-owned shop metafield rather than in our database: the
 * storefront path makes no request to us, so anything the blocks need has to
 * be data Shopify already holds. That also makes the metafield the single
 * copy — there is no local record to drift from it.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = (fallback: string) =>
  z
    .string()
    .trim()
    .regex(HEX, 'must be a hex colour')
    .catch(fallback)
    .default(fallback);

const text = (fallback: string, max = 120) =>
  z.string().trim().min(1).max(max).catch(fallback).default(fallback);

export const widgetSettingsSchema = z.object({
  starColor: hex('#FFB800'),
  textColor: hex('#1A1A1A'),
  mutedColor: hex('#6B7280'),
  borderColor: hex('#E5E7EB'),
  cornerRadius: z.coerce.number().int().min(0).max(24).catch(8).default(8),
  spacing: z.coerce.number().int().min(8).max(40).catch(16).default(16),

  heading: text('Customer reviews'),
  emptyText: text('No reviews yet. Be the first to write one.', 200),
  anonymousLabel: text('Verified customer'),
  formHeading: text('Write a review'),
  formButton: text('Submit review', 40),

  /** Quotes shown by the Review Snippet block. */
  snippetQuotes: z.coerce.number().int().min(1).max(3).catch(1).default(1),
});

export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;

/** Defaults, for a store that has never opened the customiser. */
export const WIDGET_DEFAULTS: WidgetSettings = widgetSettingsSchema.parse({});

/**
 * Parse whatever is stored, never throwing.
 *
 * `.catch()` on every field means a single bad value — a colour a merchant
 * pasted wrong, a key from an older shape — degrades to the default for that
 * field instead of collapsing the whole record and un-styling the storefront.
 */
export function parseWidgetSettings(raw: unknown): WidgetSettings {
  if (raw == null || typeof raw !== 'object') return WIDGET_DEFAULTS;
  return widgetSettingsSchema.parse(raw);
}

/**
 * The shape the theme blocks read.
 *
 * snake_case and flat: this is consumed by Liquid, where `settings.star_color`
 * is idiomatic and a nested camelCase object would have to be navigated with
 * bracket syntax at every use.
 */
export function toLiquidShape(s: WidgetSettings): Record<string, string | number> {
  return {
    star_color: s.starColor,
    text_color: s.textColor,
    muted_color: s.mutedColor,
    border_color: s.borderColor,
    corner_radius: s.cornerRadius,
    spacing: s.spacing,
    heading: s.heading,
    empty_text: s.emptyText,
    anonymous_label: s.anonymousLabel,
    form_heading: s.formHeading,
    form_button: s.formButton,
    snippet_quotes: s.snippetQuotes,
  };
}
