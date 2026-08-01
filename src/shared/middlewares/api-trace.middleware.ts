import { NextFunction, Request, RequestHandler, Response } from 'express';
import { DfxLogger } from '../services/dfx-logger';
import { getClient, isRealUnitRequest } from '../utils/request-client';

const logger = new DfxLogger('RealUnitTrace');

const REALUNIT_PATH = /^\/v\d+\/realunit\//i;

// Object keys whose value is fully replaced with `***`: credentials, personal
// data, and the client-IP / cookie headers. Body capture is scoped to the
// `/v{n}/realunit/*` paths (below), so this only has to cover the RealUnit DTOs
// — but kept deliberately broad: over-masking a harmless field is fine, leaking
// a personal one is not.
export const REDACT_KEY =
  /(^authorization$|^cookie$|^set-cookie$|^forwarded$|^r$|^s$|^v$|^unsignedtx$|token$|signature$|password|secret|mnemonic|privatekey|name$|firstname|surname|mail|phone|street|address|city|zip|postalcode|housenumber|^number$|country|nationality|gender|document|birth|iban|bic|tin|tax|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-client-ip)/i;

// Value patterns masked wherever they appear, even under a key we didn't list.
// The wallet match is exactly 40 hex — the lookahead leaves longer hex runs (tx
// hashes) intact, since those are on-chain identifiers, not PII. The EMAIL
// quantifiers are bounded so an adversarial body can't trigger super-linear
// backtracking on the request path.
const WALLET_ADDRESS = /0x[0-9a-f]{40}(?![0-9a-f])/gi;
const EMAIL = /[^\s"@/]{1,64}@[^\s"@/]{1,255}\.[^\s"@/.]{1,24}/g;
// The boundaries are against digits rather than word characters: an address is as much an address
// for having a letter or an underscore next to it, and `ip192.0.2.123` is how one usually arrives.
// A digit on either side still leaves it alone - that is a longer number, not an address.
const IPV4 = /(^|[^\d])(\d{1,3}(?:\.\d{1,3}){3})(?!\d)/g;

export const MAX_STRING = 512; // per logged string: beyond this only its length is reported
const MAX_CLIENT = 32; // per trace line: the client header is a name, not a payload
const MAX_KEY = 64; // per object key: a name, and one nobody reads past either way
const MAX_PART = 4000; // per serialized section (headers / req body / res body)
const REDACT_BUDGET = 2 * MAX_PART; // per section: bounds the compute, not just the output
const REDACTED = '***';
const WALLET_SHORT = '0x…';
const TRUNCATED = '<…truncated…>';

// The longest match the patterns above can produce - the email's 64 + `@` + 255 + `.` + 24. A caller
// that masks only the front of a value needs it: it is how far a pattern can reach past where that
// caller stopped looking.
export const MAX_MASKED_PATTERN = 64 + 1 + 255 + 1 + 24;

export function maskValue(s: string): string {
  return s.replace(WALLET_ADDRESS, WALLET_SHORT).replace(EMAIL, REDACTED).replace(IPV4, `$1${REDACTED}`);
}

export function maskUrl(url: string): string {
  // The request target is client-supplied and reaches a log line: what is left of it after the query
  // is dropped is rendered like any other value from the request. The segments are decoded first -
  // a path carries its values percent-encoded, and `victim%40example.com` is an address to everyone
  // reading the line and to no pattern matching it. A segment that will not decode is kept as it
  // came, which is what it would have been anyway.
  return maskLogText(
    url
      .split('?')[0]
      .split('/')
      .map((segment) => maskSegment(segment))
      .join('/'),
  );
}

// The decoded form is what a pattern can be recognized in; it is only what gets rendered if one was.
// Decoding otherwise would rewrite the path itself - `%2F` becomes a separator, `%3F` the start of a
// query - and the line would describe a route that was never called.
function maskSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return segment;
  }

  const masked = maskValue(decoded);
  return masked === decoded ? segment : masked;
}

// Everything that can break a line or move a cursor in a log viewer: the control characters
// (which include the ordinary line breaks and the ANSI escape) plus the two Unicode separators
// that sit outside that category.
const LINE_BREAKING = /[\p{C}\u2028\u2029]/gu;

/**
 * Removes everything that could break a log line, so a crafted value cannot forge a second line or
 * smuggle an ANSI escape into the console stream.
 */
export function singleLine(value: string): string {
  return value.replace(LINE_BREAKING, '');
}

/**
 * Renders free-form text for a log line: everything that could break a line is removed first, then
 * the value patterns above are masked.
 *
 * The removal comes first so that a character placed inside a pattern does not hide it. It can also
 * work the other way - removing a character joins what stood on either side, and a pattern that was
 * whole may stop matching - but the masking here is best effort either way, and a request that
 * arranges that is hiding what it sent about itself. What it cannot do is put a second line in the
 * log, and that is what the removal is for.
 */
export function maskLogText(value: string): string {
  return maskValue(singleLine(value));
}

/**
 * Caps a rendered value, cutting between characters rather than between code units: `slice` would
 * halve a surrogate pair sitting on the boundary and leave the stray half in front of the ellipsis,
 * which reaches the log as a replacement character.
 *
 * The walk stops at the cap rather than materializing the value first, so the work is the cap and
 * not the length of what was passed - a caller holding a request-sized string (an exception message
 * that interpolated a body value) would otherwise pay for all of it to render 500 characters.
 */
export function capCharacters(value: string, maxLength: number): string {
  let end = 0;
  for (let taken = 0; taken < maxLength; taken++) {
    if (end >= value.length) return value;
    end += (value.codePointAt(end) as number) > 0xffff ? 2 : 1;
  }

  return end >= value.length ? value : `${value.slice(0, end)}\u2026`;
}

/**
 * Cuts to a budget in code units, moving off a surrogate pair rather than through it. That is the
 * measure a section is budgeted in - `capCharacters` counts characters, which for an astral run
 * would be twice the units - so this is what the serialized sections use.
 */
function cutAtCodeUnits(value: string, maxUnits: number): string {
  if (value.length <= maxUnits) return value;

  const isHighSurrogate = value.charCodeAt(maxUnits - 1) >= 0xd800 && value.charCodeAt(maxUnits - 1) <= 0xdbff;
  return `${value.slice(0, isHighSurrogate ? maxUnits - 1 : maxUnits)}…`;
}

/**
 * Renders an untrusted value (header, rejected body field) for inclusion in a log line: it goes
 * through {@link maskLogText} - stripped of anything that could break the line, then masked - and
 * is then capped. The masking runs before the cut, so a truncated email or wallet cannot slip
 * through.
 *
 * Beyond `MAX_STRING` the value is reported by length instead: masking is regex work over the
 * whole string, and the caller's cap alone would not stop an oversized one from paying for it.
 * That length is in UTF-16 code units, the measure `MAX_STRING` is compared against and the one
 * `String.length` gives for free - counting characters would mean walking the oversized string
 * this branch exists to avoid, so the unit is named rather than converted.
 */
export function maskLogValue(value: string, maxLength: number): string {
  if (value.length > MAX_STRING) return `<${value.length} code units>`;

  return capCharacters(maskLogText(value), maxLength);
}

// `budget` bounds the total work per section: each processed node deducts from
// it and the walk stops once it is spent, so a 20 MB body can't burn seconds of
// synchronous CPU (regexes + stringify) just to emit a 4000-char log line.
function redact(value: unknown, key: string | undefined, budget: { left: number }): unknown {
  if (budget.left <= 0) return TRUNCATED;
  // Resolve the array case first: a tampered HTTP parameter (header / body) can
  // be an array, so this runs before any typeof / length / string comparison
  // (CodeQL js/type-confusion-through-parameter-tampering). The key is passed
  // through so array elements under a sensitive key are still masked.
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const entry of value) {
      if (budget.left <= 0) {
        out.push(TRUNCATED);
        break;
      }
      out.push(redact(entry, key, budget));
    }
    return out;
  }
  budget.left -= (key?.length ?? 0) + 8;
  if (key && REDACT_KEY.test(key) && value != null && value !== '') return REDACTED;
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  if (typeof value === 'string') {
    budget.left -= Math.min(value.length, MAX_STRING);
    return value.length > MAX_STRING ? `<… ${value.length} chars …>` : maskLogText(value);
  }
  if (value && typeof value === 'object') {
    // No prototype: a key called `constructor` is a key like any other here, and nothing inherited
    // can be mistaken for something this object already holds.
    const out: Record<string, unknown> = Object.create(null);
    const taken = new Map<string, number>();

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (budget.left <= 0) {
        out['…'] = TRUNCATED;
        break;
      }
      // The key is rendered like a value - a request chooses it just as freely, at whatever length,
      // so it goes through the same guard against masking an oversized one. The raw key decides the
      // redaction, since that is the name the list was written against, and two keys that render
      // the same each keep their entry, counted rather than searched for.
      const rendered = maskLogValue(k, MAX_KEY);
      const seen = taken.get(rendered) ?? 0;
      taken.set(rendered, seen + 1);

      const key = seen === 0 ? rendered : `${rendered} (${seen + 1})`;
      budget.left -= key.length;
      out[key] = redact(v, k, budget);
    }
    return out;
  }
  return value;
}

function format(value: unknown): string {
  if (value === undefined || value === null) return '(empty)';
  let s: string;
  try {
    // redact() handles Buffer + the array case (Array.isArray first), so the
    // raw value is never length/type-inspected here.
    // `redact` has rendered the keys and the values already. What is left is that `JSON.stringify`
    // escapes the control characters but leaves U+2028 / U+2029 as they are, and the trace is the
    // single line the caller below documents.
    s = singleLine(JSON.stringify(redact(value, undefined, { left: REDACT_BUDGET })));
  } catch {
    return '(unserializable)';
  }
  return s.length > MAX_PART ? `${cutAtCodeUnits(s, MAX_PART)}(${s.length} code units)` : s;
}

/**
 * Request/response tracer for the RealUnit internal test phase (DEV + PRD — see
 * the environment gate in `main.ts`). Emits one INFO line per call from the
 * realunit-app (`X-Client: realunit-app`) or a `/v{n}/realunit/*` path.
 *
 * Headers + request body + response body are captured only for `/v{n}/realunit/*`
 * paths — the DTOs the redaction is tuned for. A realunit-app call to any other
 * endpoint is logged metadata-only (method/path/status/duration/client), so
 * generic KYC/ident bodies are never traced through this RealUnit-scoped denylist.
 *
 * Personal data is redacted — credentials, names, addresses, email, phone,
 * document/IBAN/BIC etc. by key, plus wallet addresses / emails / IPv4 by value.
 * Each section is size-capped and binary bodies are summarized, and the whole
 * trace is a single INFO line, so the pipeline can't split it into fragments and
 * mis-tag them as ERROR.
 */
export function apiTraceMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientStr = getClient(req);

    // Same gate as develop's inline client/path test, via the shared (anchored) helpers.
    const isRealUnitPath = REALUNIT_PATH.test(req.originalUrl);
    if (!isRealUnitRequest(req)) return next();

    const start = Date.now();
    let responseBody: unknown;

    // Only capture bodies for the RealUnit paths the redaction is built for.
    if (isRealUnitPath) {
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        responseBody = body;
        return originalJson(body);
      };

      const originalSend = res.send.bind(res);
      res.send = (body: any) => {
        if (responseBody === undefined) responseBody = body;
        return originalSend(body);
      };
    }

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const path = maskUrl(req.originalUrl);
      // The client header is the one free-form value on this line: it arrives from the caller, so
      // it is rendered like every other one rather than interpolated as it came.
      const client = maskLogValue(clientStr, MAX_CLIENT) || '(none)';
      const meta = `${req.method} ${path} → ${res.statusCode} (${durationMs}ms)  client=${client}`;
      if (isRealUnitPath) {
        logger.info(
          `${meta}  req.headers=${format(req.headers)}  req.body=${format(req.body)}  res.body=${format(responseBody)}`,
        );
      } else {
        logger.info(meta);
      }
    });

    next();
  };
}
