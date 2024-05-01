import { Injectable } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
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

    const hash = Util.createHash(entity.sourceType + new Date() + Util.randomId()).toUpperCase();
    entity.uid = `T${hash.slice(0, 16)}`;

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    let entity = await this.getTransactionById(id);
    if (!entity) throw new Error('Transaction not found');

    Object.assign(entity, dto);

    entity = await this.repo.save(entity);

    await this.transactionNotificationService.sendTxAssignedMail(entity);

    return entity;
  }

  async getTransactionById(id: number, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async getTransactionByUid(uid: string, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { uid }, relations });
  }

  async getTransactionByCkoId(ckoId: string, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { checkoutTx: { paymentId: ckoId } }, relations });
  }

  async getTransactionsWithoutUid(filterDate: Date): Promise<Transaction[]> {
    return this.repo.findBy({ uid: IsNull(), created: LessThanOrEqual(filterDate) });
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
