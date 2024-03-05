import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from 'src/subdomains/supporting/dex/interfaces';
import { SupplementaryStrategyRegistry } from './supplementary.strategy-registry';

export abstract class SupplementaryStrategy implements OnModuleInit, OnModuleDestroy {
  @Inject() private readonly registry: SupplementaryStrategyRegistry;

  onModuleInit() {
    this.registry.add(this.blockchain, this);
  }

  onModuleDestroy() {
    this.registry.remove(this.blockchain);
  }

  abstract get blockchain(): Blockchain;

  abstract transferLiquidity(request: TransferRequest): Promise<string>;
  abstract transferMinimalCoin(address: string): Promise<string>;
  abstract checkTransferCompletion(transferTxId: string): Promise<boolean>;
  abstract findTransaction(query: TransactionQuery): Promise<TransactionResult>;
  abstract getTargetAmount(amount: number, from: Asset, to: Asset): Promise<number>;

  async calculatePrice(from: Asset, to: Asset): Promise<number> {
    const amount = from.minimalPriceReferenceAmount;

    const targetAmount = await this.getTargetAmount(amount, from, to);

    return Util.round(amount / targetAmount, 8);
  }
}
