import { Injectable } from '@nestjs/common';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
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

  async getNumberOfPendingOrders(_asset: Asset): Promise<number> {
    return 0;
  }

  // --- HELPER METHODS --- //

  async getForBank(
    bankName: IbanBankName | CardBankName,
    assets: LiquidityManagementAsset[],
  ): Promise<LiquidityBalance[]> {
    const balances: LiquidityBalance[] = [];

    try {
      switch (bankName) {
        case IbanBankName.OLKY:
          const balance = await this.olkypayService.getBalance().then((b) => b.balance);
          assets.forEach((asset) => balances.push(LiquidityBalance.create(asset, balance)));

          break;

        case CardBankName.CHECKOUT:
          const checkoutBalances = await this.checkoutService.getBalances();

          assets.forEach((asset) => {
            const balance =
              checkoutBalances.find((b) => b.holding_currency === asset.dexName).balances.collateral / 100;

            balances.push(LiquidityBalance.create(asset, balance));
          });

          break;

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
