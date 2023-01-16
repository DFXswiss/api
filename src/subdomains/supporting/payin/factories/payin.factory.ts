import { Injectable } from '@nestjs/common';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInEntry } from '../interfaces';

@Injectable()
export class PayInFactory {
  createFromTransaction(tx: PayInEntry): CryptoInput {
    return CryptoInput.create(tx.address, tx.txId, tx.txType, tx.blockHeight, tx.amount, tx.asset);
  }
}
