import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionDto } from '../dto/input/update-transaction.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  constructor(private readonly repo: TransactionRepository) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    return await this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new BadRequestException('Transaction not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }
}
