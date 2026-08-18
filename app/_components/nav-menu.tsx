'use client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'ui-nav-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/**
 * The admin's left-hand app navigation.
 *
 * `ui-nav-menu` is an App Bridge custom element: Shopify hoists these links
 * into the admin chrome itself, so they render as part of the store's
 * navigation rather than as another menu bar inside our iframe. The first
 * anchor MUST be the app root — App Bridge treats it as the home link and
 * hides it from the rendered list.
 *
 * Plain <a> elements, not next/link: the navigation lives outside our React
 * tree once Shopify adopts it, so client-side routing cannot drive it.
 */
export function NavMenu() {
  return (
    <ui-nav-menu>
      <a href="/" rel="home">
        Cited
      </a>
      <a href="/reviews">Reviews</a>
      <a href="/products">Products</a>
      <a href="/settings">Settings</a>
    </ui-nav-menu>
  );
}
