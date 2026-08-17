import { describe, it, expect } from 'vitest';
import { isPrivateDatastoreHost } from './env';

/**
 * This predicate decides whether production is allowed to boot.
 *
 * Both directions are dangerous. Too strict and every deploy fails against the
 * Docker service names the app actually uses — which is exactly what happened
 * before these cases existed. Too loose and a publicly routable datastore
 * holding customer email addresses is accepted over a cleartext socket.
 */
describe('isPrivateDatastoreHost', () => {
  it('accepts the Coolify container hostnames production actually uses', () => {
    // Single-label names cannot resolve on public DNS, so the hop is internal.
    expect(isPrivateDatastoreHost('postgres://u:p@i4ix8ki1yyxyyr2g1ijo84fl:5432/cited')).toBe(true);
    expect(isPrivateDatastoreHost('redis://u:p@fplf3d3ffte3qjsoqcezqb16:6379/0')).toBe(true);
  });

  it('accepts loopback and the local docker stack', () => {
    expect(isPrivateDatastoreHost('postgresql://cited:cited@localhost:5433/cited')).toBe(true);
    expect(isPrivateDatastoreHost('redis://127.0.0.1:6380')).toBe(true);
    expect(isPrivateDatastoreHost('redis://[::1]:6379')).toBe(true);
  });

  it('accepts RFC1918 ranges', () => {
    expect(isPrivateDatastoreHost('postgres://u:p@10.0.0.5:5432/db')).toBe(true);
    expect(isPrivateDatastoreHost('postgres://u:p@172.16.0.9:5432/db')).toBe(true);
    expect(isPrivateDatastoreHost('postgres://u:p@172.31.255.1:5432/db')).toBe(true);
    expect(isPrivateDatastoreHost('postgres://u:p@192.168.1.20:5432/db')).toBe(true);
    expect(isPrivateDatastoreHost('postgres://u:p@db.internal:5432/db')).toBe(true);
  });

  it('rejects the publicly routable host the local .env points at', () => {
    // This is the real exposure: the developer machine reaching the server's
    // published Postgres port across the internet.
    expect(isPrivateDatastoreHost('postgresql://u:p@91.239.208.85:5460/cited')).toBe(false);
    expect(isPrivateDatastoreHost('redis://u:p@91.239.208.85:6390/0')).toBe(false);
  });

  it('rejects public hostnames and near-miss private ranges', () => {
    expect(isPrivateDatastoreHost('postgres://u:p@db.example.com:5432/x')).toBe(false);
    // 172.15 and 172.32 sit outside the RFC1918 block; an off-by-one here
    // would quietly accept a public address.
    expect(isPrivateDatastoreHost('postgres://u:p@172.15.0.1:5432/x')).toBe(false);
    expect(isPrivateDatastoreHost('postgres://u:p@172.32.0.1:5432/x')).toBe(false);
    expect(isPrivateDatastoreHost('postgres://u:p@11.0.0.1:5432/x')).toBe(false);
    expect(isPrivateDatastoreHost('postgres://u:p@193.168.1.1:5432/x')).toBe(false);
  });

  it('fails closed on an unparseable url', () => {
    expect(isPrivateDatastoreHost('not a url')).toBe(false);
    expect(isPrivateDatastoreHost('')).toBe(false);
  });
});
