'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  BlockStack,
  Banner,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';
import { showToast } from './toast';

export interface CampaignRow {
  id: string;
  enabled: boolean;
  delayHours: number;
  subject: string;
  reminderCount: number;
  confirmedAt: Date | null;
  /** Orders currently waiting, used to warn before a large first batch. */
  pendingCount: number;
  safetyThreshold: number;
  /** False on Free — the whole card is read-only and shows an upgrade prompt. */
  entitled: boolean;
  /** Requests sent this calendar month, and the ceiling. Null when uncapped. */
  usedThisMonth: number;
  monthlyCap: number | null;
}

const DELAYS = [
  { label: '1 day after delivery', value: '24' },
  { label: '3 days after delivery', value: '72' },
  { label: '7 days after delivery', value: '168' },
  { label: '14 days after delivery', value: '336' },
  { label: '30 days after delivery', value: '720' },
];

/**
 * Review request settings.
 *
 * The switch is deliberately not the only control: a merchant turning this on
 * for the first time may have hundreds of fulfilled orders on file, and the
 * difference between "starts asking new customers" and "emails everyone who
 * ever bought from me" is the difference between a feature and an incident.
 * When the pending count crosses the safety threshold they are told the number
 * and asked to confirm it separately.
 */
export function CampaignSettings({ campaign }: { campaign: CampaignRow }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(campaign.enabled);
  const [delay, setDelay] = useState(String(campaign.delayHours));
  const [subject, setSubject] = useState(campaign.subject);
  const [reminder, setReminder] = useState(String(campaign.reminderCount));
  const [saving, setSaving] = useState(false);

  const needsConfirmation =
    !campaign.confirmedAt && campaign.pendingCount >= campaign.safetyThreshold;

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      try {
        const idToken = await window.shopify?.idToken?.();
        if (!idToken) throw new Error('not authenticated');

        const res = await fetch('/api/campaign', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error ?? `request failed (${res.status})`);
        }
        showToast('Review requests updated');
        router.refresh();
      } catch (err) {
        showToast((err as Error).message, { isError: true });
      } finally {
        setSaving(false);
      }
    },
    [router],
  );

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Review requests
              </Text>
              <Badge tone={enabled ? 'success' : undefined}>{enabled ? 'On' : 'Off'}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Email customers after their order is fulfilled, asking them to review what they
              bought.{' '}
              {!campaign.entitled
                ? 'Available on Pro and Scale.'
                : campaign.monthlyCap === null
                  ? 'Unlimited on your plan.'
                  : `${campaign.usedThisMonth.toLocaleString()} of ${campaign.monthlyCap.toLocaleString()} sent this month.`}
            </Text>
          </BlockStack>
          <Button
            variant={enabled ? undefined : 'primary'}
            loading={saving}
            // Turning ON is blocked while a large first batch is unconfirmed,
            // and on a plan that does not include requests at all. Turning OFF
            // is never blocked — a merchant must always be able to stop sending
            // immediately, including after a downgrade.
            disabled={!enabled && (needsConfirmation || !campaign.entitled)}
            onClick={() => {
              const next = !enabled;
              setEnabled(next);
              void save({ enabled: next });
            }}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </InlineStack>

        {!campaign.entitled && (
          <Banner tone="info" title="Review requests are on Pro and Scale">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                Your store keeps collecting and displaying reviews without limit. Asking customers
                for them by email needs Pro, which includes a monthly allowance, or Scale, which is
                uncapped.
              </Text>
              <InlineStack>
                <Button size="slim" url="/plans">
                  See plans
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        {campaign.entitled &&
          campaign.monthlyCap !== null &&
          campaign.usedThisMonth >= campaign.monthlyCap && (
            <Banner tone="warning" title="Monthly allowance used">
              <Text as="p" variant="bodySm">
                You have sent all {campaign.monthlyCap.toLocaleString()} review requests included
                this month. Sending resumes automatically on the 1st; Scale removes the cap.
              </Text>
            </Banner>
          )}

        {needsConfirmation && (
          <Banner tone="warning" title="Confirm before the first send">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                You have {campaign.pendingCount} fulfilled orders with no request sent. Turning this
                on would email all of them. Confirm you want that, or they will stay held.
              </Text>
              <InlineStack>
                <Button
                  size="slim"
                  loading={saving}
                  onClick={() => void save({ confirmLargeBatch: true })}
                >
                  {`Yes, email these ${campaign.pendingCount} customers`}
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        <Select
          label="When to ask"
          options={DELAYS}
          value={delay}
          disabled={!campaign.entitled}
          onChange={(value) => {
            setDelay(value);
            void save({ delayHours: Number(value) });
          }}
        />

        <TextField
          label="Subject line"
          value={subject}
          onChange={setSubject}
          onBlur={() => subject.trim() && subject !== campaign.subject && void save({ subject })}
          autoComplete="off"
          disabled={!campaign.entitled}
          maxLength={200}
          helpText="Shown in the inbox. The email itself names the products they bought."
        />

        <Select
          label="Follow-up"
          options={[
            { label: 'No reminder', value: '0' },
            { label: 'One reminder a week later', value: '1' },
          ]}
          value={reminder}
          disabled={!campaign.entitled}
          onChange={(value) => {
            setReminder(value);
            void save({ reminderCount: Number(value) });
          }}
        />

        <Text as="p" variant="bodySm" tone="subdued">
          Customers who unsubscribe, whose order was refunded, or who have already reviewed the
          product are skipped automatically.
        </Text>
      </BlockStack>
    </Card>
  );
}
