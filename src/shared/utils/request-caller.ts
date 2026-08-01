import { Request } from 'express';
import { maskLogValue } from 'src/shared/middlewares/api-trace.middleware';
import { getClient } from 'src/shared/utils/request-client';

// Caps per header. All three are client-supplied and unauthenticated (see the note in
// `request-client.ts`): they are a diagnostic hint about who is calling, never an identity.
const MAX_CLIENT_LENGTH = 32;
const MAX_ORIGIN_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 96;

/**
 * Renders what a request says about its caller — `X-Client`, the requesting site, and the user
 * agent — for a log line.
 *
 * On an endpoint that runs without authentication these headers are all a log line has to go on:
 * without them, a partner integration, one of our own apps and a third-party script are the same
 * anonymous caller. Of the referring URL only the origin is used — never its path or query, which
 * can carry personal data or tokens — so a browser-side caller can be named by site.
 */
export function describeCaller(req: Request): string {
  // The exception filter is the last line of defence: a request object without headers (a
  // non-HTTP execution context) must not turn a rejected request into a 500 in here.
  if (!req?.headers) return 'client=(none)';

  const parts = [`client=${maskLogValue(getClient(req), MAX_CLIENT_LENGTH) || '(none)'}`];

  const origin = callerOrigin(req);
  if (origin) parts.push(`origin=${maskLogValue(origin, MAX_ORIGIN_LENGTH)}`);

  const userAgent = firstHeader(req, 'user-agent');
  if (userAgent) parts.push(`ua=${maskLogValue(userAgent, MAX_USER_AGENT_LENGTH)}`);

  return parts.join(' ');
}

function callerOrigin(req: Request): string {
  const origin = firstHeader(req, 'origin');
  if (origin) return origin;

  const referer = firstHeader(req, 'referer');
  if (!referer) return '';

  try {
    return new URL(referer).origin;
  } catch {
    // Not a parsable URL — dropped rather than logged raw, since the unparsed value would be the
    // one part of the referer that is not reduced to its origin.
    return '';
  }
}

// A tampered header can arrive as an array (CodeQL js/type-confusion-through-parameter-tampering).
function firstHeader(req: Request, name: string): string {
  const value = req.headers[name];
  return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
}
