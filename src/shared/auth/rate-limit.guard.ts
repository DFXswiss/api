import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { getClientIp } from '@supercharge/request-ip';
import { Config } from 'src/config/config';

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string {
    const ip = getClientIp(req);
    return ip.split('.').slice(0, -1).join('.');
  }

  async handleRequest(context: ExecutionContext, limit: number, ttl: number): Promise<boolean> {
    // Skip rate limiting if deactivated
    if (!Config.request.limitCheck) return true;

    const req = context.switchToHttp().getRequest();
    const ip = getClientIp(req);

    // Skip rate limiting
    if (Config.request.knownIps.includes(ip)) {
      return true;
    }

    return super.handleRequest(context, limit, ttl);
  }
}
