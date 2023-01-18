import { Injectable } from '@nestjs/common';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { ForwardStrategy } from './base/forward.strategy';
import { CryptoInput } from '../../../entities/crypto-input.entity';

@Injectable()
export class BitcoinStrategy extends ForwardStrategy {
  constructor(protected readonly bitcoinService: PayInBitcoinService, protected readonly payInRepo: PayInRepository) {
    super();
  }

  async doForward(payIns: CryptoInput[]): Promise<void> {
    await this.bitcoinService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        const { outTxId, feeAmount } = await this.bitcoinService.forwardUtxo(payIn);
        payIn.forward(outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        console.error(`Failed to forward Bitcoin input ${payIn.id}:`, e);
      }
    }
  }
}
