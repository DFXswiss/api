import { Injectable } from '@nestjs/common';
import { MoneroTransactionType, MoneroTransferDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexMoneroService {
  private readonly client: MoneroClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, moneroService: MoneroService) {
    this.client = moneroService.getDefaultClient();
  }

  async sendTransfer(address: string, amount: number): Promise<string> {
    return this.client.sendTransfer(address, amount).then((r) => r.txid);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.client.isTxComplete(transferTxId);
  }

  async getRecentHistory(blockCount: number): Promise<MoneroTransferDto[]> {
    const currentBlockHeight = await this.client.getBlockHeight();
    return this.client.getTransfers(MoneroTransactionType.in, currentBlockHeight - blockCount);
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.client.getNativeCoinBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'XMR', blockchain: Blockchain.MONERO },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
