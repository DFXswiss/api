import { Injectable } from '@nestjs/common';
import { PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { ForwardStrategy } from './base/forward.strategy';
import { CryptoInput } from '../../../entities/crypto-input.entity';

@Injectable()
export class DeFiChainTokenStrategy extends ForwardStrategy {
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
        payIn.designateForward();

        await this.payInRepo.save(payIn);
        await this.deFiChainService.forwardToken(payIn);
      } catch (e) {
        console.error(`Failed to forward DeFiChain token input ${payIn.id}:`, e);
      }
    }
  }
}
