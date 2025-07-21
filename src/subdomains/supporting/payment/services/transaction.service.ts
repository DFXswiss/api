import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { UpdateTransactionDto } from 'src/subdomains/core/history/dto/update-transaction.dto';
import { Between, FindOptionsRelations, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionInternalDto } from '../dto/input/update-transaction-internal.dto';
import { Transaction, TransactionSourceType } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  constructor(private readonly repo: TransactionRepository) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    entity.uid = `${Config.prefixes.transactionUidPrefix}${Util.randomString(16)}`;

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionInternalDto | UpdateTransactionDto): Promise<Transaction> {
    const entity = await this.getTransactionById(id, { request: { supportIssues: true }, supportIssues: true });
    if (!entity) throw new Error('Transaction not found');

    return this.updateInternal(entity, dto);
  }

  async updateInternal(
    entity: Transaction,
    dto: UpdateTransactionInternalDto | UpdateTransactionDto,
  ): Promise<Transaction> {
    Object.assign(entity, dto);

    if (!(dto instanceof UpdateTransactionDto)) {
      entity.externalId = dto.request?.externalTransactionId;

      if (dto.resetMailSendDate) entity.mailSendDate = null;
      if (dto.request)
        entity.supportIssues = [...(entity.supportIssues ?? []), ...(entity.request.supportIssues ?? [])];
    }

    return this.repo.save(entity);
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

  async getTransactionByRequestUid(
    requestUid: string,
    relations: FindOptionsRelations<Transaction>,
  ): Promise<Transaction> {
    return this.repo.findOne({ where: { request: { uid: requestUid } }, relations });
  }

  async getTransactionByExternalId(
    externalId: string,
    accountId: number,
    relations: FindOptionsRelations<Transaction> = {},
  ): Promise<Transaction> {
    return this.repo.findOne({ where: { externalId, user: { userData: { id: accountId } } }, relations });
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
          chargebackOutput: true,
        },
        buyFiat: { sell: true, cryptoInput: true, bankTx: true, fiatOutput: true },
        refReward: true,
        bankTx: true,
        bankTxReturn: true,
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
          chargebackOutput: true,
        },
        buyFiat: { sell: true, cryptoInput: true, bankTx: true, fiatOutput: true },
        refReward: true,
      },
    });
  }

  async getManualRefVolume(ref: string): Promise<{ volume: number; credit: number }> {
    const { volume, credit } = await this.repo
      .createQueryBuilder('transaction')
      .select('SUM(refReward.amountInEur / user.refFeePercent)', 'volume')
      .addSelect('SUM(refReward.amountInEur)', 'credit')
      .leftJoinAndSelect('transaction.user', 'user')
      .leftJoinAndSelect('transaction.refReward', 'refReward')
      .where('sourceType = :sourceType', { sourceType: TransactionSourceType.MANUAL_REF })
      .andWhere('user.ref = :ref', { ref })
      .getRawOne<{ volume: number; credit: number }>();

    return { volume: volume ?? 0, credit: credit ?? 0 };
  }

  async getAllTransactionsForUserData(
    userDataId: number,
    relations: FindOptionsRelations<Transaction> = {},
  ): Promise<Transaction[]> {
    return this.repo.find({ where: { userData: { id: userDataId } }, relations });
  }

  async getTransactionByKey(key: string, value: any): Promise<Transaction> {
    return this.repo
      .createQueryBuilder('transaction')
      .select('transaction')
      .leftJoinAndSelect('transaction.userData', 'userData')
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
