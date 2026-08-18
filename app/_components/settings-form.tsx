'use client';

import { useState } from 'react';
import { BlockStack, Card, Checkbox, InlineStack, Text, Toast } from '@shopify/polaris';

/**
 * Settings save on toggle rather than behind a Save button.
 *
 * Two independent booleans with no validation between them: a save step would
 * only add a way to lose a change. The previous value is restored if the
 * request fails, so the checkbox never shows a state the server rejected.
 */
export function SettingsForm({
  analyticsPixelEnabled,
  gdprMode,
}: {
  analyticsPixelEnabled: boolean;
  gdprMode: boolean;
}) {
  const [pixel, setPixel] = useState(analyticsPixelEnabled);
  const [gdpr, setGdpr] = useState(gdprMode);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  async function save(patch: { analyticsPixelEnabled?: boolean; gdprMode?: boolean }) {
    const previous = { pixel, gdpr };
    setSaving(true);
    if (patch.analyticsPixelEnabled !== undefined) setPixel(patch.analyticsPixelEnabled);
    if (patch.gdprMode !== undefined) setGdpr(patch.gdprMode);

    try {
      const idToken = await window.shopify?.idToken?.();
      if (!idToken) throw new Error('not authenticated');

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setToast({ message: 'Saved' });
    } catch (err) {
      setPixel(previous.pixel);
      setGdpr(previous.gdpr);
      setToast({ message: (err as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Privacy & data
          </Text>

          <InlineStack gap="200" blockAlign="start" wrap={false}>
            <Checkbox
              label="Storefront analytics pixel"
              helpText="Measures how review content affects conversion. Turning this off costs you the review-impact reporting but nothing else — unlike most review apps, you can disable it without uninstalling."
              checked={pixel}
              disabled={saving}
              onChange={(value) => void save({ analyticsPixelEnabled: value })}
            />
          </InlineStack>

          <InlineStack gap="200" blockAlign="start" wrap={false}>
            <Checkbox
              label="Strict GDPR mode"
              helpText="Shortens retention and minimises what is stored about reviewers. Recommended if you sell into the EU."
              checked={gdpr}
              disabled={saving}
              onChange={(value) => void save({ gdprMode: value })}
            />
          </InlineStack>
        </BlockStack>
      </Card>

      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
          duration={3000}
        />
      )}
    </>
  );
}
