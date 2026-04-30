import { Injectable } from '@nestjs/common';
import { JuiceService } from 'src/integration/blockchain/juice/juice.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { LiquidityManagementOrder } from '../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../enums';
import { OrderNotProcessableException } from '../../exceptions/order-not-processable.exception';
import { CorrelationId } from '../../interfaces';
import { LiquidityManagementBalanceService } from '../../services/liquidity-management-balance.service';
import { FrankencoinBasedAdapter, FrankencoinBasedAdapterCommands } from './base/frankencoin-based.adapter';

export enum JuiceAdapterCommands {
  BRIDGE_IN = 'bridge-in',
  BRIDGE_OUT = 'bridge-out',
}

@Injectable()
export class JuiceAdapter extends FrankencoinBasedAdapter {
  constructor(
    liquidityManagementBalanceService: LiquidityManagementBalanceService,
    readonly juiceService: JuiceService,
    private readonly assetService: AssetService,
  ) {
    super(LiquidityManagementSystem.JUICE, liquidityManagementBalanceService, juiceService);

    // Juice doesn't have a wrapper contract
    this.commands.delete(FrankencoinBasedAdapterCommands.WRAP);

    this.commands.set(JuiceAdapterCommands.BRIDGE_IN, this.bridgeIn.bind(this));
    this.commands.set(JuiceAdapterCommands.BRIDGE_OUT, this.bridgeOut.bind(this));
  }

  async checkCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    if (
      order.action.command === JuiceAdapterCommands.BRIDGE_IN ||
      order.action.command === JuiceAdapterCommands.BRIDGE_OUT
    ) {
      const client = this.juiceService.getEvmClient();
      const txHash = order.correlationId;

      try {
        return await client.isTxComplete(txHash);
      } catch {
        return false;
      }
    }

    return super.checkCompletion(order);
  }

  validateParams(command: string, params: Record<string, unknown>): boolean {
    switch (command) {
      case JuiceAdapterCommands.BRIDGE_IN:
        return this.validateBridgeInParams(params);

      case JuiceAdapterCommands.BRIDGE_OUT:
        return false; // not yet implemented

      default:
        return super.validateParams(command, params);
    }
  }

  async getStableToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'JUSD',
      type: AssetType.TOKEN,
      blockchain: Blockchain.CITREA,
    });
  }

  async getEquityToken(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'JUICE',
      type: AssetType.TOKEN,
      blockchain: Blockchain.CITREA,
    });
  }

  private async bridgeIn(order: LiquidityManagementOrder): Promise<CorrelationId> {
    const { asset } = this.parseBridgeInParams(order.action.paramMap);

    const jusdAsset = await this.getStableToken();
    const sourceAsset = await this.assetService.getAssetByQuery({
      name: asset,
      type: AssetType.TOKEN,
      blockchain: jusdAsset.blockchain,
    });

    const sourceBalance = await this.juiceService.getEvmClient().getTokenBalance(sourceAsset);

    if (sourceBalance < order.minAmount) {
      throw new OrderNotProcessableException(
        `Not enough ${sourceAsset.name} liquidity (balance: ${sourceBalance}, min. requested: ${order.minAmount}, max. requested: ${order.maxAmount})`,
      );
    }

    const amount = Math.min(order.maxAmount, sourceBalance);

    order.inputAmount = amount;
    order.inputAsset = sourceAsset.name;
    order.outputAmount = amount;
    order.outputAsset = jusdAsset.name;

    return this.juiceService.bridgeToJusd(sourceAsset, amount);
  }

  private async bridgeOut(_order: LiquidityManagementOrder): Promise<CorrelationId> {
    // TODO: Implement bridge out (JUSD → USD stablecoins)
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
