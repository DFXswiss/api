import { Injectable } from '@nestjs/common';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Between, FindOptionsRelations, In, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionDto } from '../dto/input/update-transaction.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';
import { TransactionNotificationService } from './transaction-notification.service';

@Injectable()
export class TransactionService {
  constructor(
    private readonly repo: TransactionRepository,
    private readonly transactionNotificationService: TransactionNotificationService,
  ) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    let entity = await this.getTransaction(id);
    if (!entity) throw new Error('Transaction not found');

    Object.assign(entity, dto);

    entity = await this.repo.save(entity);

    await this.transactionNotificationService.sendTxAssignedMail(entity);

    return entity;
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

  async getTransactionsForUsers(users: User[], from = new Date(0), to = new Date()): Promise<Transaction[]> {
    return this.repo.find({
      where: { user: { id: In(users.map((u) => u.id)) }, type: Not(IsNull()), created: Between(from, to) },
      relations: {
        buyCrypto: {
          buy: { user: true },
          cryptoRoute: { user: true },
          bankTx: true,
          checkoutTx: true,
          cryptoInput: true,
        },
        buyFiat: { sell: { user: true }, cryptoInput: true, bankTx: true },
        refReward: { user: true },
      },
    });
  }
}
