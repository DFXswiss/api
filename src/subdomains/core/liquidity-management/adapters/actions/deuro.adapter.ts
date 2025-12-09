import { Injectable } from '@nestjs/common';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId } from '../../interfaces';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

export enum DEuroAdapterCommands {
  BRIDGE_EURC = 'bridge-eurc',
}

@Injectable()
export class DEuroAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    readonly deuroService: DEuroService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.DEURO, liquidityManagementBalanceService, deuroService);

    this.commands.set(DEuroAdapterCommands.BRIDGE_EURC, this.bridgeEurc.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    if (order.action.command === DEuroAdapterCommands.BRIDGE_EURC) {
      const client = this.deuroService.getEvmClient();
      const txHash = order.correlationId;

      try {
        const receipt = await client.getTxReceipt(txHash);
        if (receipt && receipt.status === 1) {
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    return super.checkCompletion(order);
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'dEURO',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }

  async getEquityToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'nDEPS',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }

  private async getEurcToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'EURC',
      type: AssetType.TOKEN,
      blockchain: Blockchain.ETHEREUM,
    });
  }

  private async bridgeEurc(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const eurcAsset = await this.getEurcToken();
    const dEuroAsset = await this.getStableToken();

    const eurcBalance = await this.deuroService.getEvmClient().getTokenBalance(eurcAsset);

    if (eurcBalance < order.minAmount) {
      throw new OrderNotProcessableException(
        `Not enough EURC liquidity (balance: ${eurcBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Math.min(order.maxAmount, eurcBalance);

    order.inputAmount = amount;
    order.inputAsset = eurcAsset.name;
    order.outputAmount = amount;
    order.outputAsset = dEuroAsset.name;

    const weiAmount = EvmUtil.toWeiAmount(amount, eurcAsset.decimals);
    return this.deuroService.bridgeEurcToDeuro(weiAmount);
  }
}
