import { Injectable } from '@nestjs/common';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { ForwardStrategy } from './base/forward.strategy';

@Injectable()
export class DeFiChainCoinStrategy extends ForwardStrategy {
  constructor(
    protected readonly deFiChainService: PayInDeFiChainService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super();
  }

  async doForward(payIns: CryptoInput[]): Promise<void> {
    await this.deFiChainService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        const { outTxId, feeAmount } = await this.deFiChainService.forwardUtxo(payIn);
        payIn.forward(outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        console.error(`Failed to forward DeFiChain coin input ${payIn.id}:`, e);
      }
    }
  }
}
