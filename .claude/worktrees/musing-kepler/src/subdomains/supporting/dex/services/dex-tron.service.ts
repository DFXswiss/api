import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TronTransactionDto } from 'src/integration/blockchain/tron/dto/tron.dto';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { TronClient } from 'src/integration/blockchain/tron/tron-client';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexTronService {
  private readonly tronClient: TronClient;

  private readonly nativeCoin = 'TRX';
  private readonly blockchain = Blockchain.TRON;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    tronService: TronService,
  ) {
    this.tronClient = tronService.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.tronClient.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    return this.tronClient.sendTokenFromDex(address, token, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.tronClient.isTxComplete(transferTxId);
  }

  async checkNativeCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.tronClient.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTokenAvailability(asset: Asset, inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.tronClient.getTokenBalance(asset);

    return [inputAmount, availableAmount - pendingAmount];
  }

  async getRecentHistory(txCount: number): Promise<TronTransactionDto[]> {
    return this.tronClient.getHistory(txCount);
  }

  getNativeCoin(): string {
    return this.nativeCoin;
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(assetName: string): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: assetName, blockchain: this.blockchain },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
