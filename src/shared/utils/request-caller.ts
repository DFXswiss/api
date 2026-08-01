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
 * anonymous caller. Of the requesting URL only the origin is used — never its path or query, which
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

// Both headers are reduced to their origin, `Origin` included: it is supposed to carry nothing
// else, but it arrives from the client like everything here, and a value that is not what it is
// supposed to be is exactly the one that must not reach the log with a query string attached.
//
// The first header that yields an origin wins, not the first one that is present: an `Origin` the
// client filled with something else should cost its own attribution, not the `Referer`'s too.
function callerOrigin(req: Request): string {
  for (const header of ['origin', 'referer']) {
    const origin = toOrigin(firstHeader(req, header));
    if (origin) return origin;
  }

  return '';
}

function toOrigin(url: string): string {
  // What a browser sends for an opaque origin — a sandboxed frame, a redirect across sites. It is
  // not a URL and cannot be reduced to one, but "the caller has no origin to name" is itself worth
  // the line, and it is a fixed word rather than anything the client composed.
  if (url === 'null') return url;

  try {
    return new URL(url).origin;
  } catch {
    // Not a parsable URL — dropped rather than logged raw, since the unparsed value would be the
    // one that is not reduced to its origin.
    return '';
  }
}

// A tampered header can arrive as an array (CodeQL js/type-confusion-through-parameter-tampering).
function firstHeader(req: Request, name: string): string {
  const value = req.headers[name];
  return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
}
