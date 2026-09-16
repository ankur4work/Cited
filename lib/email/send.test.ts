import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string | undefined> = {
  FROM_EMAIL: 'no-reply@example.com',
  SES_CONFIGURATION_SET: 'cited-reviews',
  AWS_REGION: 'us-east-1',
};

vi.mock('@/lib/env', () => ({ env: mockEnv }));
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { sendEmail, emailConfigured, emailProvider, EmailError } = await import('./send');

const MESSAGE = {
  to: 'shopper@example.com',
  subject: 'How did it work out?',
  html: '<p>hi</p>',
  text: 'hi',
  fromName: 'Acme',
};

afterEach(() => {
  delete mockEnv.BREVO_API_KEY;
  delete mockEnv.AWS_ACCESS_KEY_ID;
  delete mockEnv.AWS_SECRET_ACCESS_KEY;
  vi.unstubAllGlobals();
});

describe('emailProvider', () => {
  it('is none when nothing is configured', () => {
    expect(emailProvider()).toBe('none');
    expect(emailConfigured()).toBe(false);
  });

  it('is ses when only AWS credentials exist', () => {
    mockEnv.AWS_ACCESS_KEY_ID = 'x';
    mockEnv.AWS_SECRET_ACCESS_KEY = 'y';
    expect(emailProvider()).toBe('ses');
    expect(emailConfigured()).toBe(true);
  });

  it('prefers brevo when both are configured', () => {
    // Brevo needs one key and no sandbox exit; SES is the fallback kept for
    // when volume makes the price difference matter.
    mockEnv.BREVO_API_KEY = 'k';
    mockEnv.AWS_ACCESS_KEY_ID = 'x';
    mockEnv.AWS_SECRET_ACCESS_KEY = 'y';
    expect(emailProvider()).toBe('brevo');
  });

  it('needs BOTH AWS values, not one', () => {
    // A half-configured SES is not a sender. Treating it as one would mean
    // every send throws at runtime instead of the job logging and returning.
    mockEnv.AWS_ACCESS_KEY_ID = 'x';
    expect(emailConfigured()).toBe(false);
  });
});

describe('sendEmail via Brevo', () => {
  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('posts the documented request shape and returns the messageId', async () => {
    mockEnv.BREVO_API_KEY = 'key_123';
    const fetchMock = stubFetch(201, { messageId: '<abc@brevo>' });

    const result = await sendEmail({ ...MESSAGE, replyTo: 'shop@example.com' });
    expect(result.providerId).toBe('<abc@brevo>');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init as { headers: Record<string, string> }).headers['api-key']).toBe('key_123');

    const body = JSON.parse((init as { body: string }).body);
    expect(body.sender).toEqual({ email: 'no-reply@example.com', name: 'Acme' });
    expect(body.to).toEqual([{ email: 'shopper@example.com' }]);
    expect(body.replyTo).toEqual({ email: 'shop@example.com' });
    expect(body.htmlContent).toBe('<p>hi</p>');
    expect(body.textContent).toBe('hi');
  });

  it('treats a 4xx as permanent', async () => {
    // A rejected address will be rejected again. Retrying damages sender
    // reputation shared by every merchant on the account.
    mockEnv.BREVO_API_KEY = 'key_123';
    stubFetch(400, { message: 'Invalid email' });
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ retryable: false });
  });

  it('treats a 429 as retryable', async () => {
    // The free tier is 300/day; hitting the cap is a wait, not a failure.
    mockEnv.BREVO_API_KEY = 'key_123';
    stubFetch(429, { message: 'rate limited' });
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ retryable: true });
  });

  it('treats a 5xx as retryable', async () => {
    mockEnv.BREVO_API_KEY = 'key_123';
    stubFetch(503, { message: 'unavailable' });
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({ retryable: true });
  });

  it('fails rather than reporting success when no messageId comes back', async () => {
    // A send with no provider id cannot be traced to a bounce later.
    mockEnv.BREVO_API_KEY = 'key_123';
    stubFetch(201, {});
    await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(EmailError);
  });

  it('strips characters that would break the From header', async () => {
    // A shop name reaches the sender display name; a newline there would let
    // a store name inject additional headers.
    mockEnv.BREVO_API_KEY = 'key_123';
    const fetchMock = stubFetch(201, { messageId: 'x' });
    await sendEmail({ ...MESSAGE, fromName: 'Acme\r\nBcc: evil@example.com' });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.sender.name).not.toContain('\n');
    expect(body.sender.name).not.toContain('\r');
  });
});
