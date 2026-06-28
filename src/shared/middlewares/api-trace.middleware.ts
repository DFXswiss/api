import { NextFunction, Request, RequestHandler, Response } from 'express';
import { DfxLogger } from '../services/dfx-logger';
import { getClient, isRealUnitRequest } from '../utils/request-client';

const logger = new DfxLogger('RealUnitTrace');

// Keys whose values are masked: auth header, JWT/access tokens, signatures, credentials.
// Anchored so public fields like `tokenInfo` / `tokenAddress` are NOT redacted.
const SECRET_KEY = /(^authorization$|token$|signature$|password|secret|mnemonic|privatekey)/i;
const MAX_STRING = 512;
const REDACTED = '***';

function redact(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY.test(key) && value != null && value !== '') return REDACTED;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `<… ${value.length} chars …>` : value;
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
    return JSON.stringify(redact(value), null, 2);
  } catch {
    return '(unserializable)';
  }
}

/**
 * Full request/response tracer for the RealUnit internal test phase.
 * Enabled on DEV and PRD — see the environment gate in `main.ts`.
 *
 * Emits one log block per call originating from the realunit-app — detected
 * either via the `X-Client: realunit-app` header or a `/v{n}/realunit/*` path
 * (the latter also covers app builds shipped before the header existed).
 * Secrets are masked; KYC/PII bodies are kept intact by design — on PRD this
 * means real customer data is written to the container logs.
 */
export function apiTraceMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientStr = getClient(req);

    if (!isRealUnitRequest(req)) return next();

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
      const block = [
        `${req.method} ${req.originalUrl} → ${res.statusCode} (${durationMs}ms)  ` +
          `client=${clientStr || '(none)'} ip=${req.realIp}`,
        `  req.headers: ${format(req.headers)}`,
        `  req.body:    ${format(req.body)}`,
        `  res.body:    ${format(responseBody)}`,
      ].join('\n');
      logger.info(block);
    });

    next();
  };
}
