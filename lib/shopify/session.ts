import { jwtVerify } from 'jose';
import { env } from '../env';
import { ShopDomainSchema } from './validators';

export interface ShopifySessionClaims {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
  shop: string;
}

const secretKey = new TextEncoder().encode(env.SHOPIFY_API_SECRET);

export async function verifySessionToken(token: string): Promise<ShopifySessionClaims> {
  // jose validates: signature (HS256), aud=API_KEY, exp (with 5s tolerance),
  // nbf. We still need to assert: iss protocol+host matches dest host, dest
  // parses cleanly, shop domain matches our allowlist regex.
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
    audience: env.SHOPIFY_API_KEY,
    clockTolerance: 5,
  });

  const dest = typeof payload.dest === 'string' ? payload.dest : '';
  const iss = typeof payload.iss === 'string' ? payload.iss : '';

  if (!dest || !iss || !payload.sub || !payload.exp) {
    throw new Error('Session token missing required claims');
  }

  let destUrl: URL;
  let issUrl: URL;
  try {
    destUrl = new URL(dest);
    issUrl = new URL(iss);
  } catch {
    throw new Error('Session token dest/iss not a URL');
  }

  // Built-for-Shopify review checks for this — iss and dest must share a host.
  if (destUrl.host !== issUrl.host) {
    throw new Error('Session token iss/dest host mismatch');
  }

  const parsedShop = ShopDomainSchema.parse(destUrl.host);

  return {
    iss,
    dest,
    aud: payload.aud as string,
    sub: payload.sub as string,
    exp: payload.exp as number,
    nbf: (payload.nbf as number | undefined) ?? 0,
    iat: (payload.iat as number | undefined) ?? 0,
    jti: (payload.jti as string | undefined) ?? '',
    sid: (payload as { sid?: string }).sid ?? '',
    shop: parsedShop,
  };
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}
