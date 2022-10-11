import { Injectable } from '@nestjs/common';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { BankTxReturn } from './bank-tx-return.entity';
import { BankTxReturnRepository } from './bank-tx-return.repository';

export interface BankTxReturnInterface {
  bankTx: BankTx;
  chargebackBankTx: BankTx;
  info: string;
}

@Injectable()
export class BankTxReturnService {
  constructor(private readonly bankTxReturnRepo: BankTxReturnRepository) {}

  async create(bankTxReturn: BankTxReturnInterface): Promise<BankTxReturn> {
    const entity = this.bankTxReturnRepo.create(bankTxReturn);

    return await this.bankTxReturnRepo.save(entity);
  }
}
