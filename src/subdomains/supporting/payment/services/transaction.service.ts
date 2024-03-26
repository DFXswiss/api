import { Injectable } from '@nestjs/common';
import { FindOptionsRelations, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionDto } from '../dto/input/update-transaction.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  constructor(private readonly repo: TransactionRepository) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    const entity = await this.getTransaction(id);
    if (!entity) throw new Error('Transaction not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

  async getTransaction(id: number, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async getTransactionsWithoutUser(filterDate: Date): Promise<Transaction[]> {
    return this.repo.find({
      where: [
        { user: IsNull(), created: LessThanOrEqual(filterDate), buyCrypto: { id: Not(IsNull()) } },
        { user: IsNull(), created: LessThanOrEqual(filterDate), buyFiat: { id: Not(IsNull()) } },
        { user: IsNull(), created: LessThanOrEqual(filterDate), refReward: { id: Not(IsNull()) } },
      ],
      relations: {
        user: true,
        buyCrypto: { buy: { user: true }, cryptoRoute: { user: true } },
        buyFiat: { sell: { user: true } },
        refReward: { user: true },
      },
    });
  }
}
