import { Injectable } from '@nestjs/common';
import { PayIn } from '../entities/payin.entity';
import { PayInEntry } from '../interfaces';

@Injectable()
export class PayInFactory {
  createFromTransaction(tx: PayInEntry): PayIn {
    return PayIn.create(tx.address, tx.txId, tx.blockHeight, tx.amount, tx.asset);
  }
}
