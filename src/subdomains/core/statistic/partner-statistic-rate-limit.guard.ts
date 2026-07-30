import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Config } from 'src/config/config';

/**
 * Wallet-scoped rate limit for partner statistic routes.
 *
 * The shared RateLimitGuard keys by IP prefix and bypasses known/Azure IPs, so it does not
 * bound repeated scrapes by a single partner JWT. These routes authenticate first (AuthGuard),
 * then count by `jwt.user` (wallet id). There is no other user/wallet tracker in the repo.
 */
@Injectable()
export class PartnerStatisticRateLimitGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): string {
    const walletId = req.user?.user;
    if (walletId != null) return `partner-stat:wallet:${walletId}`;
    // AuthGuard should have run first; fall back so a mis-ordered guard still keys something.
    return `partner-stat:ip:${req.realIp ?? 'unknown'}`;
  }

  async handleRequest(context: ExecutionContext, limit: number, ttl: number): Promise<boolean> {
    if (!Config.request.limitCheck) return true;
    return super.handleRequest(context, limit, ttl);
  }
}
