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
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

export const MAX_STRING = 512; // per logged string: beyond this only its length is reported
const MAX_PART = 4000; // per serialized section (headers / req body / res body)
const REDACT_BUDGET = 2 * MAX_PART; // per section: bounds the compute, not just the output
const REDACTED = '***';
const TRUNCATED = '<…truncated…>';

export function maskValue(s: string): string {
  return s.replace(WALLET_ADDRESS, '0x…').replace(EMAIL, REDACTED).replace(IPV4, REDACTED);
}

export function maskUrl(url: string): string {
  return maskValue(url.split('?')[0]);
}

// Everything that can break a line or move a cursor in a log viewer: the control characters
// (which include the ordinary line breaks and the ANSI escape) plus the two Unicode separators
// that sit outside that category.
const LINE_BREAKING = /[\p{C}\u2028\u2029]/gu;

/**
 * Collapses everything that could break a log line into spaces, so a crafted value cannot forge a
 * second line or smuggle an ANSI escape into the console stream. Every free-form value this file
 * renders into a log line goes through it.
 */
export function singleLine(value: string): string {
  return value.replace(LINE_BREAKING, ' ');
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
 * Renders an untrusted value (header, rejected body field) for inclusion in a log line: anything
 * that could break the line collapses to a space, so a crafted value cannot forge a second log
 * line or smuggle an ANSI escape into the console stream; PII is masked and the result is
 * length-capped. Masking runs before the cut, so a truncated email or wallet cannot slip through.
 *
 * Beyond `MAX_STRING` the value is reported by length instead: masking is regex work over the
 * whole string, and the caller's cap alone would not stop an oversized one from paying for it.
 * That length is in UTF-16 code units, the measure `MAX_STRING` is compared against and the one
 * `String.length` gives for free - counting characters would mean walking the oversized string
 * this branch exists to avoid, so the unit is named rather than converted.
 */
export function maskLogValue(value: string, maxLength: number): string {
  if (value.length > MAX_STRING) return `<${value.length} code units>`;

  return capCharacters(maskValue(singleLine(value)), maxLength);
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
    return value.length > MAX_STRING ? `<… ${value.length} chars …>` : maskValue(value);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (budget.left <= 0) {
        out['…'] = TRUNCATED;
        break;
      }
      out[k] = redact(v, k, budget);
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
    // `JSON.stringify` escapes the control characters but leaves U+2028 / U+2029 as they are, so
    // the serialized section is put through the same collapse as the free-form values above - it is
    // what keeps the trace the single line the caller below documents.
    s = singleLine(JSON.stringify(redact(value, undefined, { left: REDACT_BUDGET })));
  } catch {
    return '(unserializable)';
  }
  return s.length > MAX_PART ? `${capCharacters(s, MAX_PART)}(${s.length} code units)` : s;
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
      const meta = `${req.method} ${path} → ${res.statusCode} (${durationMs}ms)  client=${clientStr || '(none)'}`;
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
