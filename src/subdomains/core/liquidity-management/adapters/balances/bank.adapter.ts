import { Injectable } from '@nestjs/common';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTxBatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-batch.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
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
    private readonly yapealService: YapealService,
  ) {}

  async getBalances(assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    const liquidityManagementAssets = Util.groupBy<LiquidityManagementAsset, LiquidityManagementContext>(
      assets,
      'context',
    );

    const balances = await Util.doGetFulfilled(
      Array.from(liquidityManagementAssets.entries()).map(([e, a]) =>
        this.getForBank(
          Object.values(IbanBankName).find((b) => b === e),
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

  async getForBank(bankName: IbanBankName, assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
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
