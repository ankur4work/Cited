import type { NextRequest } from 'next/server';
import type { Store } from '@prisma/client';
import { prisma } from '../prisma';
import { verifySessionToken, shopFromDest } from './session-token';

export class UnauthorizedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Authenticate a request from the embedded app and return its store.
 *
 * Every merchant-triggered write goes through here. The shop is taken from the
 * SIGNED `dest` claim, never from a query parameter or body field — otherwise
 * any caller could moderate another merchant's reviews by naming their domain,
 * which is a cross-tenant write, not a permissions nicety.
 */
export async function requireSessionStore(req: NextRequest): Promise<Store> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    throw new UnauthorizedError('missing session token');
  }

  const payload = verifySessionToken(auth.slice(7).trim());
  const shop = shopFromDest(payload.dest);
  if (!shop) throw new UnauthorizedError('bad dest claim');

  const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
  if (!store || store.uninstalledAt) throw new UnauthorizedError('store not installed');

  return store;
}
