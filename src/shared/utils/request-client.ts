import { Request } from 'express';

// Identifies the client application a request originates from, via the trusted `X-Client` header
// (and, for legacy app builds, the `/v{n}/realunit/*` path). This is a per-request, server-read
// signal of the calling app - distinct from the user's persisted wallet, which is set once at
// signup and is not a reliable indicator of which app a given request came from.

export const CLIENT_HEADER = 'x-client';

const REALUNIT_CLIENT = /realunit-app/i;
const REALUNIT_PATH = /^\/v\d+\/realunit\//i;

export function getClient(req: Request): string {
  const client = req.headers[CLIENT_HEADER];
  return (Array.isArray(client) ? client[0] : client) ?? '';
}

export function isRealUnitClient(client: string | undefined): boolean {
  return REALUNIT_CLIENT.test(client ?? '');
}

export function isRealUnitRequest(req: Request): boolean {
  return isRealUnitClient(getClient(req)) || REALUNIT_PATH.test(req.originalUrl);
}
