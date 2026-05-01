import { Request } from 'express';
import { isIP } from 'net';

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function extractPublicIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const ip = normalizeIp(raw);
  return isIP(ip) && !isPrivateIp(ip) ? ip : undefined;
}

/**
 * Extract the verified client IP from the request.
 *
 * Priority:
 * 1. X-Azure-SocketIP — set by Azure Front Door, cannot be spoofed
 * 2. CF-Connecting-IP — set by Cloudflare, cannot be spoofed (when origin is locked to CF IPs)
 * 3. Rightmost non-private IP from X-Forwarded-For (appended by the trusted reverse proxy)
 * 4. req.socket.remoteAddress
 */
export function getVerifiedIp(req: Request): string {
  // 1. Azure Front Door
  const azureSocketIp = extractPublicIp(getHeader(req, 'x-azure-socketip'));
  if (azureSocketIp) return azureSocketIp;

  // 2. Cloudflare
  const cfConnectingIp = extractPublicIp(getHeader(req, 'cf-connecting-ip'));
  if (cfConnectingIp) return cfConnectingIp;

  // 3. Rightmost non-private IP from X-Forwarded-For
  const xff = getHeader(req, 'x-forwarded-for');
  if (xff) {
    const ips = xff.split(',').map((s) => normalizeIp(s.trim()));
    for (let i = ips.length - 1; i >= 0; i--) {
      if (isIP(ips[i]) && !isPrivateIp(ips[i])) return ips[i];
    }
  }

  // 4. Socket remote address
  return normalizeIp(req.socket?.remoteAddress ?? 'unknown');
}

function getHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
