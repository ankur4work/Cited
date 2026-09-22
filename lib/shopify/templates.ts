/**
 * A theme's templates, as a merchant would name them.
 *
 * The theme editor is addressed by template — `?template=product`,
 * `?template=page.faq` — so "where should this widget go?" is really "which
 * template?". Merchants do not think in template names, and a list reading
 * `index`, `list-collections`, `page.about-us` is a list of filenames. So the
 * raw names are translated here, once, and both the picker and the deep link
 * read from the same parse.
 *
 * Deliberately free of React and of the Shopify client: this is string work,
 * it is the part most likely to be wrong for an unusual theme, and keeping it
 * pure is what makes it testable without either.
 */

/** Which glyph the picker draws beside a template. Resolved to a component in the UI. */
export type TemplateIcon =
  | 'home'
  | 'product'
  | 'collection'
  | 'collection-list'
  | 'cart'
  | 'page'
  | 'blog'
  | 'search'
  | 'template';

export interface ThemeTemplate {
  /** Value for the editor's `template` parameter, e.g. `product.remote-seller`. */
  key: string;
  /** What the merchant reads. An alternate is named by its suffix alone. */
  label: string;
  icon: TemplateIcon;
  /** Template type — `product` for both `product` and `product.remote-seller`. */
  base: string;
  /** False for an alternate template. */
  isDefault: boolean;
}

/**
 * The template types a storefront visitor can land on, in the order a merchant
 * would look for them — the shape of the store, roughly front to back.
 *
 * Anything absent from this table still appears, labelled by its own name.
 * Shopify's set has grown before and a template we cannot name is better shown
 * than hidden: a widget the merchant cannot place is a worse failure than a row
 * with a generic icon.
 */
const BASE: Record<string, { label: string; icon: TemplateIcon; order: number }> = {
  index: { label: 'Home page', icon: 'home', order: 0 },
  product: { label: 'Product page', icon: 'product', order: 1 },
  collection: { label: 'Collections', icon: 'collection', order: 2 },
  'list-collections': { label: 'Collections list', icon: 'collection-list', order: 3 },
  cart: { label: 'Cart page', icon: 'cart', order: 4 },
  page: { label: 'Page', icon: 'page', order: 5 },
  blog: { label: 'Blog', icon: 'blog', order: 6 },
  article: { label: 'Blog post', icon: 'blog', order: 7 },
  search: { label: 'Search results', icon: 'search', order: 8 },
  '404': { label: 'Not found (404)', icon: 'page', order: 9 },
};

const UNKNOWN = { label: '', icon: 'template' as TemplateIcon, order: 99 };

/**
 * Templates a widget must not be offered for.
 *
 * `customers/*` are the account pages, which are a separate surface with their
 * own rules; `password` is the coming-soon splash and `gift_card` is a printed
 * voucher. A reviews widget on any of them is not a placement a merchant meant
 * to make, and offering them pads the list with rows nobody picks.
 */
function isPlaceable(name: string): boolean {
  if (name.startsWith('customers/')) return false;
  return name !== 'password' && name !== 'gift_card';
}

/**
 * Turn a theme's file list into the picker's rows.
 *
 * JSON templates only. A `.liquid` template cannot hold an app block at all —
 * that is the whole distinction between a vintage theme and an Online Store 2.0
 * one — so a merchant sent to place a widget in one would find nothing to drop
 * it into and reasonably call the button broken.
 */
export function parseTemplates(filenames: string[]): ThemeTemplate[] {
  const seen = new Set<string>();
  const out: ThemeTemplate[] = [];

  for (const filename of filenames) {
    if (!filename.startsWith('templates/') || !filename.endsWith('.json')) continue;

    const name = filename.slice('templates/'.length, -'.json'.length);
    if (!name || !isPlaceable(name) || seen.has(name)) continue;
    seen.add(name);

    // `product.remote-seller` → base `product`, suffix `remote-seller`. Only
    // the FIRST dot separates them: Shopify allows further dots in the suffix
    // and `product.remote.seller` is one alternate, not a nested type.
    const dot = name.indexOf('.');
    const base = dot === -1 ? name : name.slice(0, dot);
    const suffix = dot === -1 ? '' : name.slice(dot + 1);
    const meta = BASE[base] ?? UNKNOWN;

    out.push({
      key: name,
      // An alternate is named by its suffix — that is the name the merchant
      // chose and the one they see in the admin's template dropdown. Prefixing
      // it ("Product page — faq") would be our vocabulary, not theirs.
      label: suffix || meta.label || base,
      icon: meta.icon,
      base,
      isDefault: !suffix,
    });
  }

  // Default templates first as one group, then the alternates. Grouping by
  // base instead would bury `Home page` between two product templates, and the
  // five standard pages are what almost every merchant is looking for.
  return out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const ao = BASE[a.base]?.order ?? UNKNOWN.order;
    const bo = BASE[b.base]?.order ?? UNKNOWN.order;
    if (ao !== bo) return ao - bo;
    return a.label.localeCompare(b.label);
  });
}

/**
 * The template to suggest for a widget, given what this theme actually has.
 *
 * `wanted` is the widget's natural home — a carousel's is the home page. It is
 * a suggestion and not a filter: a merchant may well want the carousel on a
 * landing page, and a theme that has no `index.json` must not leave the
 * suggestion pointing at a template that is not there.
 */
export function suggestTemplate(
  templates: ThemeTemplate[],
  wanted: string,
): ThemeTemplate | undefined {
  return (
    templates.find((t) => t.key === wanted) ??
    templates.find((t) => t.base === wanted && t.isDefault) ??
    templates.find((t) => t.base === wanted)
  );
}
