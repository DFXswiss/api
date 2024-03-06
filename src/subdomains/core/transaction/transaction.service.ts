import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Transaction } from './transaction.entity';
import { TransactionRepository } from './transaction.repository';

@Injectable()
export class TransactionService {
  private readonly logger = new DfxLogger(TransactionService);

  constructor(private repo: TransactionRepository) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    try {
      const entity = this.repo.create(dto);

      return await this.repo.save(entity);
    } catch (e) {
      this.logger.error('Exception during create transaction:', e);
    }
  }
}
