import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { UpdateTransactionDto } from 'src/subdomains/core/history/dto/update-transaction.dto';
import { Between, FindOptionsRelations, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionInternalDto } from '../dto/input/update-transaction-internal.dto';
import { Transaction } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';

@Injectable()
export class TransactionService {
  private readonly logger = new DfxLogger(TransactionService);

  constructor(private readonly repo: TransactionRepository) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.TRANSACTION_USER_SYNC, timeout: 1800 })
  async syncUserData(): Promise<void> {
    const entities = await this.repo.find({
      where: { user: { id: Not(IsNull()) }, userData: { id: IsNull() } },
      relations: { user: { userData: true }, userData: true },
      take: 10000,
    });

    for (const entity of entities) {
      try {
        await this.repo.update(entity.id, { userData: entity.user.userData });
      } catch (e) {
        this.logger.error(`Failed to sync transaction userData ${entity.id}:`, e);
      }
    }
  }

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    const hash = Util.createHash(entity.sourceType + new Date() + Util.randomId()).toUpperCase();
    entity.uid = `T${hash.slice(0, 16)}`;

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
        },
        buyFiat: { sell: true, cryptoInput: true, bankTx: true, fiatOutput: true },
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
