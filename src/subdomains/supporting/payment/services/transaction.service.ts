import { Injectable } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { UpdateTransactionDto } from 'src/subdomains/core/history/dto/update-transaction.dto';
import { Between, FindOptionsRelations, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionInternalDto } from '../dto/input/update-transaction.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  constructor(private readonly repo: TransactionRepository) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    const hash = Util.createHash(entity.sourceType + new Date() + Util.randomId()).toUpperCase();
    entity.uid = `T${hash.slice(0, 16)}`;

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionInternalDto | UpdateTransactionDto): Promise<Transaction> {
    let entity = await this.getTransactionById(id);
    if (!entity) throw new Error('Transaction not found');

    Object.assign(entity, dto);
    if (dto instanceof UpdateTransactionInternalDto) {
      entity.externalId = dto.request?.externalTransactionId;

      if (dto.resetMailSendDate) entity.mailSendDate = null;
    }

    entity = await this.repo.save(entity);

    return entity;
  }

  async getTransactionById(id: number, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async getTransactionByUid(uid: string, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { uid }, relations });
  }

  async getTransactionByRequestId(
    requestId: number,
    relations: FindOptionsRelations<Transaction>,
  ): Promise<Transaction> {
    return this.repo.findOne({ where: { request: { id: requestId } }, relations });
  }

  async getTransactionByExternalId(
    externalId: string,
    relations: FindOptionsRelations<Transaction> = {},
  ): Promise<Transaction> {
    return this.repo.findOne({ where: { externalId }, relations });
  }

  async getTransactionByCkoId(ckoId: string, relations: FindOptionsRelations<Transaction> = {}): Promise<Transaction> {
    return this.repo.findOne({ where: { checkoutTx: { paymentId: ckoId } }, relations });
  }

  async getTransactionsWithoutUid(filterDate: Date): Promise<Transaction[]> {
    return this.repo.findBy({ uid: IsNull(), created: LessThanOrEqual(filterDate) });
  }

  async getTransactionsForAccount(userDataId: number, from = new Date(0), to = new Date()): Promise<Transaction[]> {
    return this.repo.find({
      where: { user: { userData: { id: userDataId } }, type: Not(IsNull()), created: Between(from, to) },
      relations: {
        buyCrypto: {
          buy: true,
          cryptoRoute: true,
          bankTx: true,
          checkoutTx: true,
          cryptoInput: true,
        },
        buyFiat: { sell: true, cryptoInput: true, bankTx: true },
        refReward: true,
      },
    });
  }

  async getTransactionsForUser(userId: number, from = new Date(0), to = new Date()): Promise<Transaction[]> {
    return this.repo.find({
      where: { user: { id: userId }, type: Not(IsNull()), created: Between(from, to) },
      relations: {
        buyCrypto: {
          buy: true,
          cryptoRoute: true,
          bankTx: true,
          checkoutTx: true,
          cryptoInput: true,
        },
        buyFiat: { sell: true, cryptoInput: true, bankTx: true, fiatOutput: true },
        refReward: true,
      },
    });
  }

  async getTransactionByKey(key: string, value: any): Promise<Transaction> {
    return this.repo
      .createQueryBuilder('transaction')
      .select('transaction')
      .leftJoinAndSelect('transaction.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .where(`${key.includes('.') ? key : `transaction.${key}`} = :param`, { param: value })
      .getOne();
  }
}
