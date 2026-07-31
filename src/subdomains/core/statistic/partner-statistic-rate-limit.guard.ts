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
    // Unreachable when this guard is ordered after AuthGuard + RoleGuard(CLIENT_COMPANY):
    // jwt.user is set. Falling back to IP would silently weaken the budget (NAT share-out or
    // no useful key) — fail closed instead of pretending rate limiting still works.
    throw new Error('Partner statistic rate limit requires an authenticated wallet');
  }

  async handleRequest(context: ExecutionContext, limit: number, ttl: number): Promise<boolean> {
    if (!Config.request.limitCheck) return true;
    return super.handleRequest(context, limit, ttl);
  }
}
