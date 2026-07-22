import { Injectable } from '@nestjs/common';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityManagementBalanceService } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { AccountType } from '../entities/ledger-account.entity';
import { LedgerAccountService } from './ledger-account.service';

@Injectable()
export class LedgerBootstrapService {
  private readonly logger = new DfxLogger(LedgerBootstrapService);

  // §3.4 — single authoritative bootstrap name lists (character-exact)
  private static readonly LIABILITY_ACCOUNTS = [
    'buyFiat-owed',
    'buyFiat-received',
    'buyCrypto-owed',
    'buyCrypto-received',
    'refReward',
    'paymentLink',
    'bankTx-return',
    'bankTx-repeat',
    'unattributed',
    'manual-debt',
  ];

  // INCOME spread-{venue} symmetric to the EXPENSE side (venue maker rebates, §4.3 Major R12-2)
  private static readonly INCOME_ACCOUNTS = [
    'fee-buyCrypto',
    'fee-buyFiat',
    'fee-paymentLink',
    'trading',
    'spread-Binance',
    'spread-Scrypt',
    'spread-MEXC',
    'spread-XT',
    'spread-Kraken',
    'spread-arbitrage',
    'spread-DfxDex',
    'fx-revaluation',
  ];

  private static readonly EXPENSE_ACCOUNTS = [
    'spread-Binance',
    'spread-Scrypt',
    'spread-MEXC',
    'spread-XT',
    'spread-Kraken',
    'spread-arbitrage',
    'spread-DfxDex',
    'network-fee',
    'bank-fee',
    'extraordinary',
    'refReward',
    'acquirer-fee',
    'fx-revaluation',
  ];

  private static readonly EQUITY_ACCOUNTS = ['opening-balance', 'retained-earnings'];

  // §3.3 — canonical direction-neutral TRANSIT routes (predefined fix-list, line 266)
  private static readonly TRANSIT_ACCOUNTS: { route: string; currency: string }[] = [
    { route: 'bank↔Scrypt/EUR', currency: 'EUR' },
    { route: 'bank↔Scrypt/CHF', currency: 'CHF' },
    { route: 'bank↔Kraken/EUR', currency: 'EUR' },
    { route: 'bank↔bank/EUR', currency: 'EUR' },
    { route: 'bank↔bank/CHF', currency: 'CHF' },
    { route: 'wallet↔Binance/USDT', currency: 'USDT' },
    { route: 'wallet↔Binance/ETH', currency: 'ETH' },
    { route: 'wallet↔Binance/BTC', currency: 'BTC' },
    { route: 'wallet↔MEXC/USDT', currency: 'USDT' },
    { route: 'wallet↔MEXC/ETH', currency: 'ETH' },
    { route: 'wallet↔MEXC/BTC', currency: 'BTC' },
    { route: 'wallet↔Scrypt/USDT', currency: 'USDT' },
    { route: 'wallet↔Scrypt/ETH', currency: 'ETH' },
    { route: 'wallet↔Scrypt/BTC', currency: 'BTC' },
    { route: 'payout/CHF', currency: 'CHF' },
    { route: 'payout/EUR', currency: 'EUR' },
    { route: 'internal-fx/CHF', currency: 'CHF' },
    { route: 'internal-fx/EUR', currency: 'EUR' },
    { route: 'bridge/EUR', currency: 'EUR' },
    { route: 'bridge/CHF', currency: 'CHF' },
  ];

  constructor(
    private readonly ledgerAccountService: LedgerAccountService,
    private readonly assetService: AssetService,
    private readonly liquidityManagementBalanceService: LiquidityManagementBalanceService,
  ) {}

  // idempotent CoA bootstrap (§3); findOrCreate per account, re-run no-op on UNIQUE(name)
  async bootstrap(): Promise<void> {
    await this.bootstrapAssetAccounts();
    await this.bootstrapTransitAccounts();
    await this.bootstrapNamedAccounts();
  }

  // §3.2 — ASSET accounts from asset rows
  private async bootstrapAssetAccounts(): Promise<void> {
    const assets = await this.assetService.getAssetsWith({ balance: true, bank: true });
    const feedAssetIds = new Set((await this.liquidityManagementBalanceService.getBalances()).map((b) => b.asset?.id));

    const coaAssets = assets.filter((a) => this.isCoaAsset(a, feedAssetIds));

    for (const asset of coaAssets) {
      // per-asset failure isolation: on the recurring run a deterministically failing asset must not starve the
      // assets after it (and the transit/named sections) every cycle — log and continue instead of aborting
      try {
        // rename-guard: UNIQUE is on name only, so after a uniqueName change findOrCreate(name) would create a
        // second account for the same asset and make findByAssetId ambiguous — the existing account wins
        if (await this.ledgerAccountService.findByAssetId(asset.id)) continue;

        // non-null fallback for currency (currency is NOT NULL, dexName is nullable) — §3.2 Minor R7-8
        const account = await this.ledgerAccountService.findOrCreate(
          asset.uniqueName,
          AccountType.ASSET,
          asset.dexName ?? asset.name,
          asset.id,
        );

        // name collision: findOrCreate hit an account NOT belonging to this asset (another asset's pre-rename name
        // or a NULL-assetId row) → this asset still has no account and its consumers stay wedged; keep the
        // recurring re-run loud instead of no-oping. The coalesce is load-bearing: @RelationId stays unset on the
        // entity returned by the create path (only a name-hit load populates it), the create path carries the
        // asset relation stub instead.
        const ownerId = account.assetId ?? account.asset?.id;
        if (ownerId !== asset.id) {
          this.logger.error(
            `CoA account name collision: '${asset.uniqueName}' belongs to asset ${ownerId ?? 'NULL'}, no account created for asset ${asset.id}`,
          );
        } else {
          // once per new asset (the rename-guard keeps the steady state silent) — the post-deploy signal that the
          // recurring bootstrap actually created something, distinguishable from the cron not running at all
          this.logger.info(`CoA bootstrap created ASSET account '${asset.uniqueName}' for asset ${asset.id}`);
        }
      } catch (e) {
        this.logger.error(`CoA bootstrap failed for asset ${asset.id} ('${asset.uniqueName}'):`, e);
      }
    }
  }

  // §3.2 selection: Custody assets PLUS on-chain wallet assets present in liquidity_balance, MINUS CUSTOM/PRESALE
  private isCoaAsset(asset: Asset, feedAssetIds: Set<number | undefined>): boolean {
    if (asset.type === AssetType.CUSTOM || asset.type === AssetType.PRESALE) return false;
    return asset.type === AssetType.CUSTODY || feedAssetIds.has(asset.id);
  }

  // §3.3 — TRANSIT fix-list (direction-neutral); new routes created lazily by consumers
  private async bootstrapTransitAccounts(): Promise<void> {
    for (const { route, currency } of LedgerBootstrapService.TRANSIT_ACCOUNTS) {
      await this.ledgerAccountService.findOrCreate(`TRANSIT/${route}`, AccountType.TRANSIT, currency);
    }
  }

  // §3.4 — LIABILITY / INCOME / EXPENSE / EQUITY / ROUNDING / SUSPENSE
  private async bootstrapNamedAccounts(): Promise<void> {
    for (const name of LedgerBootstrapService.LIABILITY_ACCOUNTS) {
      await this.ledgerAccountService.findOrCreate(`LIABILITY/${name}`, AccountType.LIABILITY, 'CHF');
    }
    for (const name of LedgerBootstrapService.INCOME_ACCOUNTS) {
      await this.ledgerAccountService.findOrCreate(`INCOME/${name}`, AccountType.INCOME, 'CHF');
    }
    for (const name of LedgerBootstrapService.EXPENSE_ACCOUNTS) {
      await this.ledgerAccountService.findOrCreate(`EXPENSE/${name}`, AccountType.EXPENSE, 'CHF');
    }
    for (const name of LedgerBootstrapService.EQUITY_ACCOUNTS) {
      await this.ledgerAccountService.findOrCreate(`EQUITY/${name}`, AccountType.EQUITY, 'CHF');
    }

    await this.ledgerAccountService.findOrCreate('ROUNDING', AccountType.ROUNDING, 'CHF');
    await this.ledgerAccountService.findOrCreate('SUSPENSE', AccountType.SUSPENSE, 'CHF');
    // Raiffeisen untracked-bank SUSPENSE leg is EUR-native (§1.6/§4.2)
    await this.ledgerAccountService.findOrCreate('SUSPENSE/untracked-bank-Raiffeisen-EUR', AccountType.SUSPENSE, 'EUR');
  }
}
