import { NextFunction, Request, RequestHandler, Response } from 'express';
import { DfxLogger } from '../services/dfx-logger';

const logger = new DfxLogger('RealUnitTrace');

const CLIENT_HEADER = 'x-client';
const REALUNIT_CLIENT = /realunit-app/i;
const REALUNIT_PATH = /^\/v\d+\/realunit\//i;

// Object keys whose value is fully replaced with `***`: credentials, personal
// data, and the client-IP / cookie headers. Deliberately broad — over-masking a
// non-sensitive field is acceptable, leaking a personal one is not.
const REDACT_KEY =
  /(^authorization$|^cookie$|^set-cookie$|^forwarded$|token$|signature$|password|secret|mnemonic|privatekey|name$|firstname|surname|mail|phone|street|address|city|zip|postalcode|housenumber|country|nationality|birth|iban|tin|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-client-ip)/i;

// Value patterns masked wherever they appear, even under a key we didn't list.
const WALLET_ADDRESS = /0x[0-9a-fA-F]{40}/g;
const EMAIL = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

const MAX_STRING = 512;
const REDACTED = '***';

function maskValue(s: string): string {
  return s.replace(WALLET_ADDRESS, '0x…').replace(EMAIL, REDACTED).replace(IPV4, REDACTED);
}

function redact(value: unknown, key?: string): unknown {
  if (key && REDACT_KEY.test(key) && value != null && value !== '') return REDACTED;
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
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return '(empty)';
  try {
    return JSON.stringify(redact(value));
  } catch {
    return '(unserializable)';
  }
}

/**
 * Request/response tracer for the RealUnit internal test phase (DEV + PRD — see
 * the environment gate in `main.ts`). Emits one trace per call from the
 * realunit-app (detected via the `X-Client: realunit-app` header or a
 * `/v{n}/realunit/*` path): method, path, status, duration, client, request
 * headers, request body and response body.
 *
 * Personal data is redacted — credentials, names, addresses, email, phone, IBAN
 * etc. by key, and wallet addresses / emails / IPv4 by value (the client IP and
 * cookies live in the headers). The whole trace is logged on a single INFO line
 * (compact JSON, no `null, 2`) so the pipeline can't split it into fragments and
 * mis-tag them as ERROR.
 */
export function apiTraceMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const client = req.headers[CLIENT_HEADER];
    const clientStr = Array.isArray(client) ? client[0] : (client ?? '');

    const isRealUnit = REALUNIT_CLIENT.test(clientStr) || REALUNIT_PATH.test(req.originalUrl);
    if (!isRealUnit) return next();

    const start = Date.now();
    let responseBody: unknown;

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

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const path = req.originalUrl.split('?')[0].replace(WALLET_ADDRESS, '0x…');
      logger.info(
        `${req.method} ${path} → ${res.statusCode} (${durationMs}ms)  client=${clientStr || '(none)'}  ` +
          `req.headers=${format(req.headers)}  req.body=${format(req.body)}  res.body=${format(responseBody)}`,
      );
    });

    next();
  };
}
