import { Injectable } from '@nestjs/common';
import { TransactionHistory } from 'src/integration/blockchain/bitcoin/node/bitcoin-based-client';
import { BitcoinTestnet4Client } from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4-client';
import {
  BitcoinTestnet4NodeType,
  BitcoinTestnet4Service,
} from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4.service';
import { BitcoinTestnet4FeeService } from 'src/integration/blockchain/bitcoin-testnet4/services/bitcoin-testnet4-fee.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { LiquidityOrder } from '../entities/liquidity-order.entity';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';

@Injectable()
export class DexBitcoinTestnet4Service {
  private readonly client: BitcoinTestnet4Client;

  constructor(
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly feeService: BitcoinTestnet4FeeService,
    readonly bitcoinTestnet4Service: BitcoinTestnet4Service,
  ) {
    this.client = bitcoinTestnet4Service.getDefaultClient(BitcoinTestnet4NodeType.BTC_TESTNET4_OUTPUT);
  }

  async sendUtxoToMany(payout: { addressTo: string; amount: number }[]): Promise<string> {
    const feeRate = await this.feeService.getRecommendedFeeRate();
    return this.client.sendMany(payout, feeRate);
  }

  async checkAvailableTargetLiquidity(inputAmount: number): Promise<[number, number]> {
    const pendingAmount = await this.getPendingAmount();
    const availableAmount = await this.client.getBalance();

    return [inputAmount, availableAmount - pendingAmount];
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    const transaction = await this.client.getTx(transferTxId);

    return transaction != null;
  }

  async getRecentHistory(txCount: number): Promise<TransactionHistory[]> {
    return this.client.getRecentHistory(txCount);
  }

  protected getClient(): BitcoinTestnet4Client {
    return this.client;
  }

  //*** HELPER METHODS ***//

  private async getPendingAmount(): Promise<number> {
    const pendingOrders = await this.liquidityOrderRepo.findBy({
      isComplete: false,
      targetAsset: { dexName: 'BTC', blockchain: Blockchain.BITCOIN_TESTNET4 },
    });

    return Util.sumObjValue<LiquidityOrder>(pendingOrders, 'estimatedTargetAmount');
  }
}
