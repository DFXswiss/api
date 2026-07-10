import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { isIP } from 'net';
import { Config } from 'src/config/config';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string {
    const ip: string = req.realIp;

    // group IPv6 by /64 (typical single-customer allocation); the previous dot-split
    // returned '' for every IPv6 address, putting all IPv6 clients in one shared bucket
    if (isIP(ip) === 6 && !ip.includes('.')) return this.ipv6Prefix(ip);

    // group IPv4 (including IPv4-mapped IPv6) by /24
    const segments = ip.split('.');
    return segments.length === 4 ? segments.slice(0, -1).join('.') : ip;
  }

  private ipv6Prefix(ip: string): string {
    const [head, tail = ''] = ip.toLowerCase().split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const zeros = new Array(8 - headParts.length - tailParts.length).fill('0');
    return [...headParts, ...zeros, ...tailParts]
      .slice(0, 4)
      .map((part) => part.replace(/^0+(?=\w)/, ''))
      .join(':');
  }

  async handleRequest(context: ExecutionContext, limit: number, ttl: number): Promise<boolean> {
    // Skip rate limiting if deactivated
    if (!Config.request.limitCheck) return true;

    const req = context.switchToHttp().getRequest();
    const ip = req.realIp;

    // Skip rate limiting
    if (Config.request.knownIps.includes(ip) || ip.includes(Config.azureIpSubstring)) {
      return true;
    }

    return super.handleRequest(context, limit, ttl);
  }
}
