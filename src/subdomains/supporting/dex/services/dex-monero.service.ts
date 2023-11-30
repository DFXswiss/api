import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { GetTransferInResultDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexMoneroService {
  private client: MoneroClient;

  constructor(private readonly liquidityOrderRepo: LiquidityOrderRepository, moneroService: MoneroService) {
    this.client = moneroService.getDefaultClient();
  }

  async sendTransfer(address: string, amount: number): Promise<string> {
    return this.client.transfer(address, MoneroHelper.xmrToAu(amount)).then((r) => r.tx_hash);
  }

  async transferMinimal(address: string): Promise<string> {
    return this.sendTransfer(address, Config.payIn.minDeposit.Monero.XMR / 2);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    const transaction = await this.client.getTransaction(transferTxId);

    return MoneroHelper.isTransactionComplete(transaction);
  }

  async getRecentHistory(blockCount: number): Promise<GetTransferInResultDto[]> {
    const currentBlockHeight = await this.client.getBlockHeight();
    return this.client.getTransfers(currentBlockHeight - blockCount).then((t) => t.in);
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.client.getBalance().then((b) => b.unlocked_balance);

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
