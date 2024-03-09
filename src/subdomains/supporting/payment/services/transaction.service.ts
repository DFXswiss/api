import { BadRequestException, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionDto } from '../dto/input/update-transaction.dto';
import { Transaction, TransactionSourceType } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

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

  async update(sourceId: number, sourceType: TransactionSourceType, dto: UpdateTransactionDto): Promise<Transaction> {
    const entity = await this.repo.findOneBy({ sourceId, sourceType });
    if (!entity) throw new BadRequestException('Transaction not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

  async get(sourceId: number, sourceType: TransactionSourceType): Promise<Transaction> {
    return this.repo.findOneBy({ sourceId, sourceType });
  }
}
