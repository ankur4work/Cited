/**
 * Plan limits, as plain numbers with no dependencies.
 *
 * This file exists to be importable from a CLIENT component, which `lib/env`
 * is not and must never be: `lib/env` validates the whole server environment
 * at import time and THROWS when it cannot find `DATABASE_URL` and friends. A
 * browser has none of them, so one import chain from a `'use client'` file
 * into `lib/env` turns a page into Next's "Application error: a client-side
 * exception has occurred" — which is what the Plans page did, through a single
 * feature string quoting the Pro request cap.
 *
 * `lib/env` still owns the runtime value: it reads the same number from the
 * environment and falls back to this default, so an operator can raise the cap
 * without the marketing copy drifting away from it. What a client bundle gets
 * is this constant, and nothing else.
 */

/** Review request emails a Pro store may send per month. */
export const REVIEW_REQUEST_CAP_PRO_DEFAULT = 500;
