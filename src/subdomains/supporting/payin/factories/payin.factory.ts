import { Injectable } from '@nestjs/common';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';

@Injectable()
export class PayInFactory {
  createFromEntry(entry: PayInEntry): CryptoInput {
    const { address, txId, txType, txSequence, blockHeight, amount, asset } = entry;

    return CryptoInput.create(address, txId, txType, txSequence, blockHeight, amount, asset);
  }
}
