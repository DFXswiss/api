import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { FrankencoinBasedService } from 'src/integration/blockchain/shared/frankencoin/frankencoin-based.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../../../exceptions/order-not-processable.exception';
import { Command, CorrelationId } from '../../../interfaces';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { LiquidityManagementBalanceService } from '../../../services/liquidity-management-balance.service';
import { LiquidityActionAdapter } from './liquidity-action.adapter';

export enum FrankencoinBasedAdapterCommands {
  MINT = 'mint',
}

export abstract class FrankencoinBasedAdapter extends LiquidityActionAdapter {
  private readonly logger = new DfxLogger(FrankencoinBasedAdapter);

  protected commands = new Map<string, Command>();

  constructor(
    system: LiquidityManagementSystem,
    private readonly liquidityManagementBalanceService: LiquidityManagementBalanceService,
    private readonly frankencoinBasedService: FrankencoinBasedService,
    private readonly liquidityManagementOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(system);

    this.commands.set(FrankencoinBasedAdapterCommands.MINT, this.mint.bind(this));
  }

  validateParams(_command: string, _params: Record<string, unknown>): boolean {
    /**
     * @note
     * no params supported by FrankencoinBasedAdapter
     */
    return true;
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    if (order.action.command !== FrankencoinBasedAdapterCommands.MINT) return false;

    const client = this.frankencoinBasedService.getEvmClient();
    const txHash = order.correlationId;

    return client.isTxComplete(txHash);
  }

  // --- COMMAND IMPLEMENTATIONS --- //

  abstract getStableToken(): Promise<Asset>;

  private async mint(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const equityPrice = await this.frankencoinBasedService.getEquityPrice();
    const stableBuyingAmount = order.amount * equityPrice;

    const stableToken = await this.getStableToken();
    const stableLiquidityBalances = await this.liquidityManagementBalanceService.getAllLiqBalancesForAssets([
      stableToken.id,
    ]);
    const stableTotalLiquidityBalance = Util.sum(stableLiquidityBalances.map((b) => b.amount));

    if (stableBuyingAmount > stableTotalLiquidityBalance)
      throw new OrderNotProcessableException(
        `Not enough ${stableToken.name} liquidity balance: ${stableBuyingAmount} > ${stableTotalLiquidityBalance}`,
      );

    try {
      await this.liquidityManagementOrderRepo.update(order.id, {
        inputAmount: stableBuyingAmount,
        inputAsset: stableToken.name,
        outputAsset: order.target?.name,
      });

      const stableBuyingWeiAmount = EvmUtil.toWeiAmount(stableBuyingAmount, stableToken.decimals);

      const equityContract = this.frankencoinBasedService.getEquityContract();
      const expectedShares = await equityContract.calculateShares(stableBuyingWeiAmount);
      const result = await equityContract.invest(stableBuyingWeiAmount, expectedShares);

      return result.hash;
    } catch (e) {
      this.logger.error(`Buy order ${order.id} failed:`, e);
      throw new OrderFailedException(`Buy order ${order.id} failed: ${e.message}`);
    }
  }
}
