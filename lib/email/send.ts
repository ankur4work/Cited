import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Outbound email, via SES.
 *
 * SES rather than a transactional provider because review requests are bulk by
 * nature — one per fulfilled order, forever — and at roughly $0.10 per thousand
 * it is the only pricing model that survives a merchant with real order volume
 * (PLAN.md §5.4.2). Resend stays configured for one-off transactional mail.
 */

export class EmailError extends Error {
  constructor(
    message: string,
    /** False for a rejection that will recur: a bad address, a blocked domain. */
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

let cached: SESClient | null = null;

function client(): SESClient {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new EmailError('AWS credentials are not configured', false);
  }
  cached ??= new SESClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return cached;
}

export interface SendResult {
  providerId: string;
}

/**
 * Send through Brevo.
 *
 * Plain fetch rather than their SDK: this is one POST with a JSON body, and a
 * dependency whose only job is to build that body is a dependency to keep
 * patched for no benefit.
 */
async function sendViaBrevo(input: SendInput, from: string): Promise<SendResult> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY!,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.FROM_EMAIL, name: input.fromName ? sanitiseDisplayName(input.fromName) : undefined },
      to: [{ email: input.to }],
      replyTo: input.replyTo ? { email: input.replyTo } : undefined,
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
      tags: input.tags ? Object.values(input.tags).map((v) => v.slice(0, 64)) : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 4xx describes the request or the recipient and will recur; 429 and 5xx
    // are worth another attempt. Retrying a rejected address damages sender
    // reputation for every merchant on the account.
    const retryable = res.status === 429 || res.status >= 500;
    throw new EmailError(`brevo ${res.status}: ${body.slice(0, 300)}`, retryable);
  }

  const json = (await res.json().catch(() => ({}))) as { messageId?: string };
  if (!json.messageId) throw new EmailError('Brevo accepted the send but returned no messageId');

  // `from` is already folded into the sender object above; named here only so
  // the SES and Brevo paths share one signature.
  void from;
  return { providerId: json.messageId };
}

interface SendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

/**
 * Send one email.
 *
 * `configurationSet` is what wires SES's bounce and complaint notifications
 * back to us. Sending without it means a hard bounce is invisible, the address
 * is retried on the next campaign, and the sender reputation that every other
 * merchant on this account shares degrades quietly.
 */
export async function sendEmail(input: SendInput): Promise<SendResult> {
  const from = input.fromName
    ? `${sanitiseDisplayName(input.fromName)} <${env.FROM_EMAIL}>`
    : env.FROM_EMAIL;

  // Brevo first when configured. Whichever provider is used, the caller sees
  // the same result shape and the same EmailError semantics — swapping
  // providers must never mean revisiting the processor.
  if (env.BREVO_API_KEY) return sendViaBrevo(input, from);

  try {
    const res = await client().send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [input.to] },
        ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
        ConfigurationSetName: env.SES_CONFIGURATION_SET,
        // SES rejects tag values outside [A-Za-z0-9_-], and an id we generated
        // is not worth failing a send over — sanitised rather than trusted.
        Tags: input.tags
          ? Object.entries(input.tags).map(([Name, Value]) => ({
              Name,
              Value: Value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 256),
            }))
          : undefined,
        Message: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: input.html, Charset: 'UTF-8' },
            Text: { Data: input.text, Charset: 'UTF-8' },
          },
        },
      }),
    );

    if (!res.MessageId) throw new EmailError('SES accepted the request but returned no MessageId');
    return { providerId: res.MessageId };
  } catch (err) {
    if (err instanceof EmailError) throw err;

    const name = (err as { name?: string }).name ?? '';
    // These describe the recipient, not the attempt. Retrying sends the same
    // message to the same dead address and damages sender reputation further.
    const permanent = [
      'MessageRejected',
      'MailFromDomainNotVerifiedException',
      'AccountSuspendedException',
    ].includes(name);

    throw new EmailError(`${name || 'send failed'}: ${(err as Error).message}`, !permanent);
  }
}

/**
 * A shop name reaches the From header, so it is reduced to something inert.
 *
 * A newline here would let a store name inject additional headers; quotes and
 * angle brackets would break the address parse. Bounded length because some
 * receivers truncate mid-encoding and produce mojibake.
 */
function sanitiseDisplayName(name: string): string {
  const cleaned = name.replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'Reviews';
}

/** True when SOME provider can actually send. Brevo needs one key; SES needs two. */
export function emailConfigured(): boolean {
  const ok = Boolean(
    env.BREVO_API_KEY || (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
  );
  if (!ok) logger.debug('Email not configured — review requests will not send');
  return ok;
}

/** Which provider a send would use. Logged so a misconfiguration is visible. */
export function emailProvider(): 'brevo' | 'ses' | 'none' {
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return 'ses';
  return 'none';
}
