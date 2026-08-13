import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifySessionToken, type ShopifySessionClaims } from './session';
import { logger } from '../logger';

export interface AuthContext {
  claims: ShopifySessionClaims;
  shopDomain: string;
}

export async function requireSessionToken(req: NextRequest): Promise<AuthContext | NextResponse> {
  const token = extractBearerToken(req.headers.get('authorization'));
  if (!token) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }
  try {
    const claims = await verifySessionToken(token);
    return { claims, shopDomain: claims.shop };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Session token verification failed');
    return NextResponse.json({ error: 'invalid session token' }, { status: 401 });
  }
}
