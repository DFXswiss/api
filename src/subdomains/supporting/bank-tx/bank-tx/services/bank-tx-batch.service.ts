import { Injectable } from '@nestjs/common';
import { BankTxBatch } from '../entities/bank-tx-batch.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';

@Injectable()
export class BankTxBatchService {
  constructor(private readonly bankTxBatchRepo: BankTxBatchRepository) {}

  async getBankTxBatchByIban(iban: string): Promise<BankTxBatch> {
    return this.bankTxBatchRepo.findOneBy({ iban });
  }
}
