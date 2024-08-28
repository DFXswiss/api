import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankTxBatchService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx-batch.service';
import { BankName } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { LiquidityBalance } from '../../entities/liquidity-balance.entity';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityBalanceIntegration, LiquidityManagementAsset } from '../../interfaces';

@Injectable()
export class BankAdapter implements LiquidityBalanceIntegration {
  private readonly logger = new DfxLogger(BankAdapter);

  constructor(private readonly bankService: BankService, private readonly bankTxBatchService: BankTxBatchService) {}

  async getBalances(assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    const liquidityManagementAssets = Util.groupBy<LiquidityManagementAsset, LiquidityManagementContext>(
      assets,
      'context',
    );

    const balances = await Util.doGetFulfilled(
      Array.from(liquidityManagementAssets.entries()).map(([e, a]) =>
        this.getForBank(
          Object.values(BankName).find((b) => b === e),
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

  async getForBank(bankName: BankName, assets: LiquidityManagementAsset[]): Promise<LiquidityBalance[]> {
    const balances: LiquidityBalance[] = [];
    try {
      for (const asset of assets) {
        const bank = await this.bankService.getBankInternal(bankName, asset.dexName);
        const bankTxBatch = await this.bankTxBatchService.getBankTxBatchByIban(bank.iban);

        const balance = !bankTxBatch
          ? 0
          : bankTxBatch.balanceAfterCdi === 'CRDT'
          ? bankTxBatch.balanceAfterAmount
          : -bankTxBatch.balanceAfterAmount;

        balances.push(LiquidityBalance.create(asset, balance));
      }

      return balances;
    } catch (e) {
      this.logger.error(`Failed to update liquidity management balance for ${bankName}:`, e);
      throw e;
    }
  }
}
