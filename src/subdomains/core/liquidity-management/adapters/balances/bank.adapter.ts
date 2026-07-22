import { Injectable } from '@nestjs/common';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTxBatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-batch.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityBalanceIntegration, LiquidityManagementAsset } from '../../interfaces';

@Injectable()
export class BankAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(BankAdapter);

  constructor(
    private readonly bankService: BankService,
    private readonly bankTxBatchService: BankTxBatchService,
    private readonly olkypayService: OlkypayService,
    private readonly checkoutService: CheckoutService,
    private readonly yapealService: YapealService,
    private readonly frickService: BankFrickService,
  ) {}

  async getBalances(assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    const liquidityManagementAssets = Util.groupBy<LiquidityManagementAsset, LiquidityManagementContext>(
      assets,
      'context',
    );

    const balances = await Util.doGetFulfilled(
      Array.from(liquidityManagementAssets.entries()).map(([e, a]) =>
        this.getForBank(
          [...Object.values(IbanBankName), ...Object.values(CardBankName)].find((b) => b === e),
          a,
        ),
      ),
    );

    return balances.reduce((prev, curr) => prev.concat(curr), []);
  }

  async hasPendingOrders(_asset: Asset): Promise<boolean> {
    return false;
  }

  // --- HELPER METHODS --- //

  async getForBank(
    bankName: IbanBankName | CardBankName,
    assets: LiquidityManagementAsset[],
  ): Promise<LiquidityBalance[]> {
    const balances: LiquidityBalance[] = [];

    try {
      switch (bankName) {
        case IbanBankName.OLKY: {
          const olkyBalance = await this.olkypayService.getBalance().then((b) => b.balance);
          assets.forEach((asset) => balances.push(LiquidityBalance.create(asset, olkyBalance)));

          break;
        }

        case IbanBankName.YAPEAL: {
          const yapealBalances = await this.yapealService.getBalances();

          for (const balance of yapealBalances) {
            const matchingAssets = assets.filter((asset) => asset.dexName === balance.currency);
            matchingAssets.forEach((asset) => balances.push(LiquidityBalance.create(asset, balance.availableBalance)));
          }

          break;
        }

        case IbanBankName.FRICK: {
          const frickBalances = await this.frickService.getBalances();

          const banks = await this.bankService.getBanksWithAsset();
          const matchedIbans = new Set<string>();

          for (const asset of assets) {
            const bank = banks.find((bank) => bank.asset?.id === asset.id);
            if (!bank) throw new Error(`Bank Frick account is not linked to asset ${asset.uniqueName}`);

            const bankIban = bank.iban.replace(/\s/g, '').toUpperCase();
            const balance = frickBalances.find((balance) => {
              const balanceIban = balance.iban.replace(/\s/g, '').toUpperCase();
              return balanceIban === bankIban;
            });
            if (!balance)
              throw new Error(`No Bank Frick account found for IBAN ${bank.iban} (asset ${asset.uniqueName})`);

            // A wrongly linked IBAN (e.g. a CHF account linked to a Frick EUR asset) must fail loud instead of
            // silently recording the wrong currency's balance as this asset's liquidity.
            if (balance.currency !== asset.dexName)
              throw new Error(
                `Currency mismatch for Bank Frick account ${bank.iban}: ` +
                  `expected ${asset.dexName}, found ${balance.currency} (asset ${asset.uniqueName})`,
              );

            // Bank Frick's `available` field is optional in its own account-listing contract. Falling back to
            // the booked `balance` would overstate spendable liquidity (it ignores pending debits) - exactly
            // the overdraft risk this case exists to close - so a missing available balance fails loud instead
            // of silently substituting a different, unsafe number. This only applies to the account actually
            // matched to an asset here - an unmatched account without an available balance (e.g. the operating
            // account) plays no role in any asset's liquidity figure and must not crash the refresh.
            if (!Number.isFinite(balance.availableBalance))
              throw new Error(`Missing available balance for Bank Frick account ${balance.iban}`);

            matchedIbans.add(balance.iban.replace(/\s/g, '').toUpperCase());
            balances.push(LiquidityBalance.create(asset, balance.availableBalance));
          }

          const unmatchedIbans = frickBalances
            .filter((balance) => !matchedIbans.has(balance.iban.replace(/\s/g, '').toUpperCase()))
            .map((balance) => balance.iban);
          if (unmatchedIbans.length)
            this.logger.verbose(`Ignored unmatched Bank Frick accounts: ${unmatchedIbans.join(', ')}`);

          break;
        }

        case CardBankName.CHECKOUT: {
          const checkoutBalances = await this.checkoutService.getBalances();

          assets.forEach((asset) => {
            const balance =
              checkoutBalances.find((b) => b.holding_currency === asset.dexName).balances.collateral / 100;

            balances.push(LiquidityBalance.create(asset, balance));
          });

          break;
        }

        default:
          for (const asset of assets) {
            const bank = await this.bankService.getBankInternal(bankName, asset.dexName);
            const bankTxBatch = await this.bankTxBatchService.getBankTxBatchByIban(bank.iban);
            if (!bankTxBatch) break;

            balances.push(LiquidityBalance.create(asset, bankTxBatch.bankBalanceAfter));
          }

          break;
      }

      return balances;
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for ${bankName}:`, e);
      throw e;
    }
  }
}
