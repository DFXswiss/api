import { Injectable } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Between, FindOptionsRelations, In, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { BankTx } from '../../bank-tx/bank-tx/bank-tx.entity';
import { CheckoutTx } from '../../fiat-payin/entities/checkout-tx.entity';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionDto } from '../dto/input/update-transaction.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  constructor(private readonly repo: TransactionRepository) {}

  async create(
    dto: CreateTransactionDto,
    sourceEntity: BankTx | CryptoInput | CheckoutTx | RefReward,
  ): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    const hash = Util.createHash(
      `${sourceEntity.id}` + entity.created + entity.sourceType + sourceEntity.created,
    ).toUpperCase();
    entity.uid = `${hash.slice(0, 8)}-${hash.slice(8, 16)}-${hash.slice(16, 24)}`;

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    const entity = await this.getTransactionById(id);
    if (!entity) throw new Error('Transaction not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }

  async getTransactionById(id: number, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async getTransactionByUid(uid: string, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { uid }, relations });
  }

  async getTransactionsWithoutUid(filterDate: Date): Promise<Transaction[]> {
    return this.repo.find({
      where: { uid: IsNull(), created: LessThanOrEqual(filterDate) },
      relations: {
        refReward: true,
        bankTx: true,
        cryptoInput: true,
        checkoutTx: true,
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
