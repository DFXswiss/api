import { Injectable } from '@nestjs/common';
import { CardanoClient } from 'src/integration/blockchain/cardano/cardano-client';
import { CardanoTransactionDto } from 'src/integration/blockchain/cardano/dto/cardano.dto';
import { CardanoService } from 'src/integration/blockchain/cardano/services/cardano.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexCardanoService {
  private readonly cardanoClient: CardanoClient;

  private readonly nativeCoin = 'ADA';
  private readonly blockchain = Blockchain.CARDANO;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, cardanoService: CardanoService) {
    this.cardanoClient = cardanoService.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.cardanoClient.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    return this.cardanoClient.sendTokenFromDex(address, token, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.cardanoClient.isTxComplete(transferTxId);
  }

  async checkNativeCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.cardanoClient.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTokenAvailability(asset: Asset, inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.cardanoClient.getTokenBalance(asset);

    return [inputAmount, availableAmount - pendingAmount];
  }

  async getRecentHistory(txCount: number): Promise<CardanoTransactionDto[]> {
    return this.cardanoClient.getHistory(txCount);
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
