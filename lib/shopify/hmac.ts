import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

export function verifyOAuthHmac(params: Record<string, string>): boolean {
  const { hmac, signature: _signature, ...rest } = params;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join('&');

  const computed = createHmac('sha256', env.SHOPIFY_API_SECRET).update(message).digest('hex');
  return safeEqualHex(computed, hmac);
}

export function verifyWebhookHmac(rawBody: string | Buffer, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const computed = createHmac('sha256', env.SHOPIFY_API_SECRET).update(body).digest('base64');
  return safeEqualB64(computed, hmacHeader);
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ab.length === 0 || ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function safeEqualB64(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'base64');
    const bb = Buffer.from(b, 'base64');
    if (ab.length === 0 || ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
