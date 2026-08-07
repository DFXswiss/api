import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Config } from 'src/config/config';
import { PartnerStatisticService } from './partner-statistic.service';

/**
 * Wallet-scoped rate limit for partner statistic routes.
 *
 * The shared RateLimitGuard keys by IP prefix and bypasses known/Azure IPs, so it does not
 * bound repeated scrapes by a single partner JWT. These routes authenticate first (AuthGuard),
 * then count by the **resolved** wallet id (not raw `jwt.user`: for NON_CUSTODIAL_WALLET_PARTNER that field is a
 * user id). Staff of the same wallet therefore share one budget.
 */
@Injectable()
export class PartnerStatisticRateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly partnerStatisticService: PartnerStatisticService,
  ) {
    super(options, storageService, reflector);
  }

  protected getTracker(req: Record<string, any>): string {
    const walletId = req.partnerStatWalletId;
    if (walletId != null) return `partner-stat:wallet:${walletId}`;
    // partnerStatWalletId is set in handleRequest before super.handleRequest. Falling back to
    // jwt.user would key NON_CUSTODIAL_WALLET_PARTNER traffic by user id (separate budgets per employee) or worse
    // treat a user id as a wallet id. Fail closed instead.
    // Unreachable while REQUEST_LIMIT_CHECK is not true: handleRequest returns true before
    // super.handleRequest, so getTracker is never called — fail-closed stands or falls with
    // the same switch as the budget itself.
    throw new Error('Partner statistic rate limit requires an authenticated wallet');
  }

  async handleRequest(context: ExecutionContext, limit: number, ttl: number): Promise<boolean> {
    if (!Config.request.limitCheck) return true;

    const req = context.switchToHttp().getRequest();
    // Same resolveWalletId as the controller — budget hangs on the wallet, not the JWT subject.
    req.partnerStatWalletId = await this.partnerStatisticService.resolveWalletId(req.user);
    return super.handleRequest(context, limit, ttl);
  }
}
