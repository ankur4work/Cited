import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  shopDomain?: string;
  storeId?: string;
  route?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function setShop(shopDomain: string, storeId?: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.shopDomain = shopDomain;
  if (storeId) ctx.storeId = storeId;
}

/** Run `fn` inside a fresh request context. Call at the top of every API
 *  route handler and tRPC request. */
export function withRequest<T>(
  init: { requestId?: string; route?: string } | undefined,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const ctx: RequestContext = {
    requestId: init?.requestId ?? randomUUID(),
    route: init?.route,
  };
  return storage.run(ctx, fn);
}
