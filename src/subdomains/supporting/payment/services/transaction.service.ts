import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Between, FindOptionsRelations, IsNull, LessThanOrEqual, Not } from 'typeorm';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { UpdateTransactionInternalDto } from '../dto/input/update-transaction-internal.dto';
import { UpdateTransactionDto } from '../dto/update-transaction.dto';
import { Transaction, TransactionSourceType } from '../entities/transaction.entity';
import { TransactionRepository } from '../repositories/transaction.repository';
import { SpecialExternalAccountService } from './special-external-account.service';

@Injectable()
export class TransactionService {
  constructor(
    private readonly repo: TransactionRepository,
    private readonly userDataService: UserDataService,
    private readonly bankDataService: BankDataService,
    private readonly specialExternalAccountService: SpecialExternalAccountService,
  ) {}

  async create(dto: CreateTransactionDto): Promise<Transaction | undefined> {
    const entity = this.repo.create(dto);

    entity.uid = Util.createUid(Config.prefixes.transactionUidPrefix);

    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateTransactionDto): Promise<Transaction> {
    const entity = await this.getTransactionById(id, {
      request: { supportIssues: true },
      supportIssues: true,
      bankTx: true,
    });
    if (!entity) throw new Error('Transaction not found');

    if (dto.userData) {
      dto.userData = await this.userDataService.getUserData(dto.userData.id);
      if (!dto.userData) throw new NotFoundException('UserData not found');

      if (entity.bankTx?.senderAccount) {
        const bankData = await this.bankDataService.getVerifiedBankDataWithIban(
          entity.bankTx.senderAccount,
          dto.userData.id,
        );

        if (!bankData) {
          const multiAccounts = await this.specialExternalAccountService.getMultiAccounts();
          const bankDataName = entity.bankTx.bankDataName(multiAccounts);
          if (bankDataName)
            await this.bankDataService.createVerifyBankData(dto.userData, {
              name: bankDataName,
              iban: entity.bankTx.senderAccount,
              bic: entity.bankTx.bic,
              type: BankDataType.BANK_IN,
            });
        }
      }
    }

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
      where: { userData: { id: userDataId }, type: Not(IsNull()), created: Between(from, to) },
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
        bankTx: { transaction: true },
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
      .leftJoin('transaction.user', 'user')
      .leftJoin('transaction.refReward', 'refReward')
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
      .leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .where(`${key.includes('.') ? key : `transaction.${key}`} = :param`, { param: value })
      .getOne();
  }
}
