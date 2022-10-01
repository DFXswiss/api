import { Injectable } from '@nestjs/common';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';

@Injectable()
export class BankTxReturnService {
  constructor(private readonly bankTxReturnRepo: BankTxReturnRepository) {}

  async create(bankTx: BankTx): Promise<BankTxReturn> {
    const entity = this.bankTxReturnRepo.create();

    entity.bankTx = bankTx;

    return await this.bankTxReturnRepo.save(entity);
  }
}
