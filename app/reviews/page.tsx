import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { getReviews, type ReviewStatusFilter } from '@/lib/dashboard';
import { SessionBootstrap } from '../_components/session-bootstrap';
import { ReviewsView } from '../_components/reviews-view';
import { SessionRecovery } from '../_components/session-recovery';
import { ScopeUpgrade } from '../_components/scope-upgrade';

export const dynamic = 'force-dynamic';

const VALID: ReviewStatusFilter[] = ['ALL', 'PENDING', 'PUBLISHED', 'HIDDEN', 'SPAM'];

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: { shop?: string; id_token?: string; status?: string };
}) {
  const session = await resolveEmbeddedSession({
    shop: searchParams.shop,
    idToken: searchParams.id_token,
  });

  if (session.state === 'no-shop') return <SessionRecovery title="Reviews" />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;
  if (session.state === 'needs-scopes')
    return <ScopeUpgrade shop={session.shop} missing={session.missing} />;

  const filter = VALID.includes(searchParams.status as ReviewStatusFilter)
    ? (searchParams.status as ReviewStatusFilter)
    : 'ALL';

  const reviews = await getReviews(session.store.id, filter);

  return <ReviewsView reviews={reviews} filter={filter} />;
}
