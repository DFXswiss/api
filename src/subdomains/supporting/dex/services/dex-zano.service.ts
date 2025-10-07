import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexZanoService {
  private readonly nativeCoin = 'ZANO';
  private readonly blockchain = Blockchain.ZANO;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly zanoService: ZanoService,
  ) {}

  async sendCoin(address: string, amount: number): Promise<string> {
    return this.zanoService.sendCoin(address, amount).then((r) => r.txId);
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    return this.zanoService.sendToken(address, amount, token).then((r) => r.txId);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.zanoService.isTxComplete(transferTxId);
  }

  async getRecentHistory(blockCount: number): Promise<ZanoTransferDto[]> {
    const currentBlockHeight = await this.zanoService.getBlockHeight();
    return this.zanoService.getTransactionHistory(currentBlockHeight - blockCount);
  }

  async checkCoinAvailability(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(this.nativeCoin);
    const availableAmount = await this.zanoService.getCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTokenAvailability(asset: Asset, inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount(asset.dexName);
    const availableAmount = await this.zanoService.getTokenBalance(asset);

    return [inputAmount, availableAmount - pendingAmount];
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
