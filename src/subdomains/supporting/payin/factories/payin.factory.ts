import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayIn } from '../entities/payin.entity';
import { PayInEntry } from '../interfaces';

@Injectable()
export class PayInFactory {
  createFromTransaction(tx: PayInEntry, asset: Asset): PayIn {
    return PayIn.create(tx.address, tx.txId, tx.blockHeight, tx.amount, asset);
  }
}
