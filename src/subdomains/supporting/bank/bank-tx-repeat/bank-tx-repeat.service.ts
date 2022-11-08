import { Injectable } from '@nestjs/common';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { BankTxRepeat } from './bank-tx-repeat.entity';
import { BankTxRepeatRepository } from './bank-tx-repeat.repository';

@Injectable()
export class BankTxRepeatService {
  constructor(private readonly bankTxRepeatRepo: BankTxRepeatRepository) {}

  async create(bankTx: BankTx): Promise<BankTxRepeat> {
    const entity = this.bankTxRepeatRepo.create({ bankTx });

    return await this.bankTxRepeatRepo.save(entity);
  }
}
