import { NextFunction, Request, RequestHandler, Response } from 'express';
import { DfxLogger } from '../services/dfx-logger';

const logger = new DfxLogger('RealUnitTrace');

const CLIENT_HEADER = 'x-client';
const REALUNIT_CLIENT = /realunit-app/i;
const REALUNIT_PATH = /^\/v\d+\/realunit\//i;

// Object keys whose value is fully replaced with `***`: credentials, personal
// data, and the client-IP / cookie headers. Body capture is scoped to the
// `/v{n}/realunit/*` paths (below), so this only has to cover the RealUnit DTOs
// — but kept deliberately broad: over-masking a harmless field is fine, leaking
// a personal one is not.
const REDACT_KEY =
  /(^authorization$|^cookie$|^set-cookie$|^forwarded$|token$|signature$|password|secret|mnemonic|privatekey|name$|firstname|surname|mail|phone|street|address|city|zip|postalcode|housenumber|^number$|country|nationality|gender|document|birth|iban|bic|tin|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-client-ip)/i;

// Value patterns masked wherever they appear, even under a key we didn't list.
// The wallet match is exactly 40 hex — the lookahead leaves longer hex runs (tx
// hashes, signatures) intact, since those are on-chain identifiers, not PII.
const WALLET_ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const EMAIL = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

const MAX_STRING = 512; // per string leaf
const MAX_PART = 4000; // per serialized section (headers / req body / res body)
const REDACTED = '***';

function maskValue(s: string): string {
  return s.replace(WALLET_ADDRESS, '0x…').replace(EMAIL, REDACTED).replace(IPV4, REDACTED);
}

function redact(value: unknown, key?: string): unknown {
  if (key && REDACT_KEY.test(key) && value != null && value !== '') return REDACTED;
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `<… ${value.length} chars …>` : maskValue(value);
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

function format(value: unknown): string {
  if (value === undefined || value === null) return '(empty)';
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  let s: string;
  try {
    s = JSON.stringify(redact(value));
  } catch {
    return '(unserializable)';
  }
  return s.length > MAX_PART ? `${s.slice(0, MAX_PART)}…(${s.length} chars)` : s;
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
    const client = req.headers[CLIENT_HEADER];
    const clientStr = Array.isArray(client) ? client[0] : (client ?? '');

    const isRealUnitPath = REALUNIT_PATH.test(req.originalUrl);
    if (!REALUNIT_CLIENT.test(clientStr) && !isRealUnitPath) return next();

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
      const path = req.originalUrl.split('?')[0].replace(WALLET_ADDRESS, '0x…');
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
