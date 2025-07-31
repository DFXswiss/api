import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexZanoService {
  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly zanoService: ZanoService,
  ) {}

  async sendTransfer(address: string, amount: number): Promise<string> {
    return this.zanoService.sendTransfer(address, amount).then((r) => r.txId);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.zanoService.isTxComplete(transferTxId);
  }

  async getRecentHistory(blockCount: number): Promise<ZanoTransferDto[]> {
    const currentBlockHeight = await this.zanoService.getBlockHeight();
    return this.zanoService.getTransactionHistory(currentBlockHeight - blockCount);
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.zanoService.getCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'ZANO', blockchain: Blockchain.ZANO },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
