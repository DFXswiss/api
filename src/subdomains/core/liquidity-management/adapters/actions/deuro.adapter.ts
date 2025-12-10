import { Injectable } from '@nestjs/common';
import { DEuroService } from 'src/integration/blockchain/deuro/deuro.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId } from '../../interfaces';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter } from './base/frankencoin-based.adapter';

export enum DEuroAdapterCommands {
  BRIDGE_IN = 'bridge-in',
  BRIDGE_OUT = 'bridge-out',
}

@Injectable()
export class DEuroAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    readonly deuroService: DEuroService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.DEURO, liquidityManagementBalanceService, deuroService);

    this.commands.set(DEuroAdapterCommands.BRIDGE_IN, this.bridgeIn.bind(this));
    this.commands.set(DEuroAdapterCommands.BRIDGE_OUT, this.bridgeOut.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    if (
      order.action.command === DEuroAdapterCommands.BRIDGE_IN ||
      order.action.command === DEuroAdapterCommands.BRIDGE_OUT
    ) {
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

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case DEuroAdapterCommands.BRIDGE_IN:
        return this.validateBridgeInParams(params);

      case DEuroAdapterCommands.BRIDGE_OUT:
        return false; // Not yet implemented

      default:
        throw new Error(`Command ${command} not supported by DEuroAdapter`);
    }
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

  private async bridgeIn(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { asset } = this.parseBridgeInParams(order.action.paramMap);

    const dEuroAsset = await this.getStableToken();
    const sourceAsset = await this.assetService.getAssetByQuery({
      name: asset,
      type: AssetType.TOKEN,
      blockchain: dEuroAsset.blockchain,
    });

    const sourceBalance = await this.deuroService.getEvmClient().getTokenBalance(sourceAsset);

    if (sourceBalance < order.minAmount) {
      throw new OrderNotProcessableException(
        `Not enough ${sourceAsset.name} liquidity (balance: ${sourceBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Math.min(order.maxAmount, sourceBalance);

    order.inputAmount = amount;
    order.inputAsset = sourceAsset.name;
    order.outputAmount = amount;
    order.outputAsset = dEuroAsset.name;

    return this.deuroService.bridgeToDeuro(sourceAsset, amount);
  }

  private async bridgeOut(_order: LiquidityManagementOrder): Promise<CorrelationId> {
    // TODO: Implement bridge out (dEURO → EUR stablecoins)
    throw new OrderNotProcessableException('Bridge out is not yet implemented');
  }

  private validateBridgeInParams(params: Record<string, unknown>): boolean {
    try {
      this.parseBridgeInParams(params);
      return true;
    } catch {
      return false;
    }
  }

  private parseBridgeInParams(params: Record<string, unknown>): { asset: string } {
    const asset = params.asset as string;

    if (!asset) {
      throw new Error('asset parameter is required for bridge-in command');
    }

    return { asset };
  }
}
