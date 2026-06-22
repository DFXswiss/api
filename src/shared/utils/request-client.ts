import { Request } from 'express';

// Identifies the client application a request originates from, via the `X-Client` header (and, for
// legacy app builds, the `/v{n}/realunit/*` path). This is a per-request, server-read signal of the
// calling app - distinct from the user's persisted wallet, which is set once at signup and is not a
// reliable indicator of which app a given request came from.
//
// NOTE: X-Client is client-supplied and NOT cryptographically authenticated. It is only used to pick
// mail branding (DFX vs. RealUnit visuals); it grants no access and carries no privilege, so a spoofed
// value at worst mislabels a support mail. Never gate authorization or data access on it.

export const CLIENT_HEADER = 'x-client';

// Anchored: only the exact `realunit-app` client matches (not substrings like `realunit-app-proxy`).
const REALUNIT_CLIENT = /^realunit-app$/i;
const REALUNIT_PATH = /^\/v\d+\/realunit\//i;

export function getClient(req: Request): string {
  const client = req.headers[CLIENT_HEADER];
  return ((Array.isArray(client) ? client[0] : client) ?? '').trim();
}

export function isRealUnitClient(client: string | undefined): boolean {
  return REALUNIT_CLIENT.test(client?.trim() ?? '');
}

export function isRealUnitRequest(req: Request): boolean {
  return isRealUnitClient(getClient(req)) || REALUNIT_PATH.test(req.originalUrl);
}
