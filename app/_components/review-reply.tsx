'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BlockStack, Box, Button, InlineStack, Text, TextField } from '@shopify/polaris';
import { showToast } from './toast';

const MAX_REPLY = 2_000;

/**
 * Reply to a review, publicly, as the store.
 *
 * Collapsed until the merchant asks for it. A textarea open on every row turns
 * a moderation queue into a wall of empty boxes, and replying is the rarer
 * action — most reviews need a decision, not an answer.
 *
 * A reply goes live on save. There is no draft state because the author is the
 * merchant; the moderation queue exists to protect the store from strangers,
 * and the store does not need protecting from itself.
 */
export function ReviewReply({
  reviewId,
  reply,
}: {
  reviewId: string;
  reply: string | null | undefined;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(reply ?? '');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(
    async (next: string) => {
      setSaving(true);
      try {
        const idToken = await window.shopify?.idToken?.();
        if (!idToken) throw new Error('not authenticated');

        const res = await fetch(`/api/reviews/${reviewId}/reply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reply: next }),
        });
        if (!res.ok) throw new Error(`request failed (${res.status})`);

        showToast(next.trim() ? 'Reply published' : 'Reply removed');
        setOpen(false);
        router.refresh();
      } catch (err) {
        showToast((err as Error).message, { isError: true });
      } finally {
        setSaving(false);
      }
    },
    [reviewId, router],
  );

  // Existing reply, not being edited: show it the way a shopper will see it.
  if (reply && !open) {
    return (
      <Box
        padding="300"
        background="bg-surface-secondary"
        borderRadius="200"
        borderColor="border"
        borderWidth="025"
      >
        <BlockStack gap="150">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            Your reply
          </Text>
          <Text as="p" variant="bodySm">
            {reply}
          </Text>
          <InlineStack gap="200">
            <Button size="micro" onClick={() => setOpen(true)}>
              Edit
            </Button>
            <Button
              size="micro"
              tone="critical"
              loading={saving}
              onClick={() => {
                setValue('');
                void submit('');
              }}
            >
              Remove
            </Button>
          </InlineStack>
        </BlockStack>
      </Box>
    );
  }

  if (!open) {
    return (
      <InlineStack>
        <Button size="slim" onClick={() => setOpen(true)}>
          Reply publicly
        </Button>
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="200">
      <TextField
        label="Your reply"
        labelHidden
        value={value}
        onChange={setValue}
        multiline={3}
        maxLength={MAX_REPLY}
        showCharacterCount
        autoComplete="off"
        placeholder="Reply as the store. This appears publicly, under the review."
      />
      <InlineStack gap="200">
        <Button
          variant="primary"
          size="slim"
          loading={saving}
          // An empty box is not a reply. Removing one is the Remove button,
          // which says what it does — saving blank would delete a published
          // reply while the label still said "Save".
          disabled={value.trim().length === 0}
          onClick={() => void submit(value)}
        >
          {reply ? 'Update reply' : 'Publish reply'}
        </Button>
        <Button
          size="slim"
          disabled={saving}
          onClick={() => {
            setValue(reply ?? '');
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
