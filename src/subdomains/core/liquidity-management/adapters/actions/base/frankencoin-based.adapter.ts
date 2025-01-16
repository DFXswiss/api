import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { FrankencoinBasedService } from 'src/integration/blockchain/shared/frankencoin/frankencoin-based.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../../interfaces';
import { LiquidityManagementBalanceService } from '../../../services/liquidity-management-balance.service';
import { LiquidityActionAdapter } from './liquidity-action.adapter';

export enum FrankencoinBasedAdapterCommands {
  BUY = 'buy',
}

export abstract class FrankencoinBasedAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(FrankencoinBasedAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    private readonly liquidityManagementBalanceService: LiquidityManagementBalanceService,
    private readonly frankencoinBasedService: FrankencoinBasedService,
    private readonly assetService: AssetService,
  ) {
    super(system);

    this.commands.set(FrankencoinBasedAdapterCommands.BUY, this.buy.bind(this));
  }

  validateParams(_command: string, _params: Record<string, unknown>): boolean {
    /**
     * @note
     * no params supported by FrankencoinBasedAdapter
     */
    return true;
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    if (order.action.command !== FrankencoinBasedAdapterCommands.BUY) return false;

    const txHash = order.correlationId;

    const client = this.frankencoinBasedService.getDefaultClient();
    const txReceipt = await client.getTxReceipt(txHash);
    if (!txReceipt) return false;

    return !!txReceipt.status;
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  private async buy(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const equityPrice = await this.frankencoinBasedService.getEquityPrice();
    const zchfBuyingAmount = order.amount * equityPrice;

    const zchfToken = await this.assetService.getAssetByQuery({
      name: 'ZCHF',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
    const zchfLiquidityBalances = await this.liquidityManagementBalanceService.getAllLiqBalancesForAssets([
      zchfToken.id,
    ]);
    const zchfTotalLiquidityBalance = Util.sum(zchfLiquidityBalances.map((b) => b.amount));

    if (zchfBuyingAmount > zchfTotalLiquidityBalance)
      throw new OrderNotProcessableException(
        `Not enough ZCHF liquidity balance: ${zchfBuyingAmount} > ${zchfTotalLiquidityBalance}`,
      );

    try {
      const zchfBuyingWeiAmount = EvmUtil.toWeiAmount(zchfBuyingAmount, zchfToken.decimals);

      const equityContract = this.frankencoinBasedService.getEquityContract();
      const expectedShares = await equityContract.calculateShares(zchfBuyingWeiAmount);
      const result = await equityContract.invest(zchfBuyingWeiAmount, expectedShares);

      return result.hash;
    } catch (e) {
      this.logger.error(`Buy order ${order.id} failed:`, e);
      throw new OrderNotProcessableException(`Buy order ${order.id} failed: ${e.message}`);
    }
  }
}
