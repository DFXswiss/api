import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Observable, Subject } from 'rxjs';
import { RevolutService } from 'src/integration/bank/services/revolut.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { AmountType, Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BankBalanceUpdate } from 'src/subdomains/core/liquidity-management/services/liquidity-management-balance.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { DeepPartial, FindOptionsRelations, In, IsNull, LessThan, MoreThan, MoreThanOrEqual, Not } from 'typeorm';
import { OlkypayService } from '../../../../../integration/bank/services/olkypay.service';
import { BankService } from '../../../bank/bank/bank.service';
import { TransactionSourceType, TransactionTypeInternal } from '../../../payment/entities/transaction.entity';
import { SpecialExternalAccountService } from '../../../payment/services/special-external-account.service';
import { TransactionService } from '../../../payment/services/transaction.service';
import { BankTxRepeatService } from '../../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx-return/bank-tx-return.service';
import { UpdateBankTxDto } from '../dto/update-bank-tx.dto';
import { BankTxBatch } from '../entities/bank-tx-batch.entity';
import {
  BankTx,
  BankTxIndicator,
  BankTxType,
  BankTxTypeCompleted,
  BankTxUnassignedTypes,
} from '../entities/bank-tx.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';
import { BankTxRepository } from '../repositories/bank-tx.repository';
import { SepaParser } from './sepa-parser.service';

export const TransactionBankTxTypeMapper: {
  [key in BankTxType]: TransactionTypeInternal;
} = {
  [BankTxType.INTERNAL]: TransactionTypeInternal.INTERNAL,
  [BankTxType.BUY_CRYPTO_RETURN]: TransactionTypeInternal.BUY_CRYPTO_RETURN,
  [BankTxType.BANK_TX_RETURN]: TransactionTypeInternal.BANK_TX_RETURN,
  [BankTxType.BUY_CRYPTO]: TransactionTypeInternal.BUY_CRYPTO,
  [BankTxType.BUY_FIAT]: TransactionTypeInternal.BUY_FIAT_OUTPUT,
  [BankTxType.BANK_TX_REPEAT]: TransactionTypeInternal.BANK_TX_REPEAT,
  [BankTxType.BANK_TX_RETURN_CHARGEBACK]: TransactionTypeInternal.BANK_TX_RETURN_CHARGEBACK,
  [BankTxType.BANK_TX_REPEAT_CHARGEBACK]: TransactionTypeInternal.BANK_TX_REPEAT_CHARGEBACK,
  [BankTxType.FIAT_FIAT]: TransactionTypeInternal.FIAT_FIAT,
  [BankTxType.KRAKEN]: TransactionTypeInternal.KRAKEN,
  [BankTxType.SCB]: TransactionTypeInternal.SCB,
  [BankTxType.CHECKOUT_LTD]: TransactionTypeInternal.CHECKOUT_LTD,
  [BankTxType.REVOLUT_CARD_PAYMENT]: TransactionTypeInternal.REVOLUT_CARD_PAYMENT,
  [BankTxType.BANK_ACCOUNT_FEE]: TransactionTypeInternal.BANK_ACCOUNT_FEE,
  [BankTxType.EXTRAORDINARY_EXPENSES]: TransactionTypeInternal.EXTRAORDINARY_EXPENSES,
  [BankTxType.TEST_FIAT_FIAT]: null,
  [BankTxType.GSHEET]: null,
  [BankTxType.PENDING]: null,
  [BankTxType.UNKNOWN]: null,
};

@Injectable()
export class BankTxService implements OnModuleInit {
  private readonly logger = new DfxLogger(BankTxService);
  private readonly bankBalanceSubject: Subject<BankBalanceUpdate> = new Subject<BankBalanceUpdate>();

  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly notificationService: NotificationService,
    private readonly settingService: SettingService,
    private readonly olkyService: OlkypayService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly buyService: BuyService,
    private readonly bankService: BankService,
    private readonly revolutService: RevolutService,
    private readonly transactionService: TransactionService,
    private readonly specialAccountService: SpecialExternalAccountService,
    private readonly sepaParser: SepaParser,
    private readonly bankDataService: BankDataService,
  ) {}

  onModuleInit() {
    this.bankDataService.bankDataObservable.subscribe((dto) =>
      this.checkAssignAndNotifyUserData(dto.iban, dto.userData),
    );
  }

  // --- TRANSACTION HANDLING --- //
  @DfxCron(CronExpression.EVERY_30_SECONDS, { timeout: 3600, process: Process.BANK_TX })
  async checkBankTx(): Promise<void> {
    await this.checkTransactions();
    await this.assignTransactions();
    await this.fillBankTx();
  }

  async checkTransactions(): Promise<void> {
    // Get settings
    const settingKeyOlky = 'lastBankOlkyDate';
    const settingKeyRevolut = 'lastBankRevolutDate';
    const lastModificationTimeOlky = await this.settingService.get(settingKeyOlky, new Date(0).toISOString());
    const lastModificationTimeRevolut = await this.settingService.get(settingKeyRevolut, new Date(0).toISOString());

    const newModificationTime = new Date().toISOString();

    const olkyBank = await this.bankService.getBankInternal(IbanBankName.OLKY, 'EUR');
    const revolutBank = await this.bankService.getBankInternal(IbanBankName.REVOLUT, 'EUR');

    // Get bank transactions
    const olkyTransactions = await this.olkyService.getOlkyTransactions(lastModificationTimeOlky, olkyBank.iban);
    const revolutTransactions = await this.revolutService.getRevolutTransactions(
      lastModificationTimeRevolut,
      revolutBank.iban,
    );
    const allTransactions = olkyTransactions.concat(revolutTransactions);

    const multiAccounts = await this.specialAccountService.getMultiAccounts();
    for (const transaction of allTransactions) {
      try {
        await this.create(transaction, multiAccounts);
      } catch (e) {
        if (!(e instanceof ConflictException)) this.logger.error(`Failed to import transaction:`, e);
      }
    }

    if (olkyTransactions.length > 0) await this.settingService.set(settingKeyOlky, newModificationTime);
    if (revolutTransactions.length > 0) await this.settingService.set(settingKeyRevolut, newModificationTime);
  }

  async assignTransactions(): Promise<void> {
    const unassignedBankTx = await this.bankTxRepo.find({
      where: [
        { type: IsNull(), creditDebitIndicator: BankTxIndicator.CREDIT },
        { type: IsNull(), creditDebitIndicator: BankTxIndicator.DEBIT, created: LessThan(Util.minutesBefore(5)) },
      ],
      relations: { transaction: true },
    });
    if (!unassignedBankTx.length) return;

    const buys = unassignedBankTx.some((b) => b.creditDebitIndicator === BankTxIndicator.CREDIT)
      ? await this.buyService.getAllBankUsages()
      : [];

    for (const tx of unassignedBankTx) {
      try {
        if (tx.creditDebitIndicator === BankTxIndicator.CREDIT) {
          const remittanceInfo = (!tx.remittanceInfo || tx.remittanceInfo === '-' ? tx.endToEndId : tx.remittanceInfo)
            ?.replace(/[ -]/g, '')
            .replace(/O/g, '0');
          const buy =
            remittanceInfo &&
            tx.creditDebitIndicator === BankTxIndicator.CREDIT &&
            buys.find((b) => remittanceInfo.includes(b.bankUsage.replace(/-/g, '')));

          if (buy) {
            await this.updateInternal(tx, { type: BankTxType.BUY_CRYPTO, buyId: buy.id });

            continue;
          }
        }

        if (await this.bankTxRepo.existsBy({ id: tx.id, type: Not(IsNull()) })) continue;

        await this.updateInternal(
          tx,
          tx.name === 'Payward Trading Ltd.' ? { type: BankTxType.KRAKEN } : { type: BankTxType.GSHEET },
        );
      } catch (e) {
        this.logger.error(`Error during bankTx ${tx.id} assign:`, e);
      }
    }
  }

  async fillBankTx(): Promise<void> {
    const entities = await this.bankTxRepo.find({
      where: {
        accountingAmountBeforeFee: IsNull(),
        amount: Not(IsNull()),
        chargeAmount: Not(IsNull()),
        type: Not(In(BankTxUnassignedTypes)),
      },
      relations: { buyCrypto: true, buyFiats: true },
    });

    for (const entity of entities) {
      try {
        if (![BankTxType.BUY_CRYPTO, BankTxType.BUY_FIAT].includes(entity.type)) {
          await this.bankTxRepo.update(entity.id, {
            accountingAmountBeforeFee: Util.roundReadable(entity.amount + entity.chargeAmount, AmountType.FIAT),
          });
          continue;
        }
        if (!entity.buyCrypto && !entity.buyFiats?.length) continue;

        const update: Partial<BankTx> = {};

        if (entity.type === BankTxType.BUY_CRYPTO) {
          update.accountingFeePercent = entity.buyCrypto.percentFee;
          update.accountingFeeAmount = update.accountingFeePercent * (entity.amount + entity.chargeAmount);
          update.accountingAmountAfterFee = entity.amount + entity.chargeAmount - update.accountingFeeAmount;
          update.accountingAmountBeforeFeeChf = entity.buyCrypto.amountInChf;
          update.accountingAmountAfterFeeChf = entity.buyCrypto.amountInChf * (1 - update.accountingFeePercent);
        } else {
          update.accountingFeePercent = entity.buyFiats[0].percentFee;
          update.accountingFeeAmount =
            update.accountingFeePercent * ((entity.amount + entity.chargeAmount) / (1 - update.accountingFeePercent));
          update.accountingAmountAfterFee = entity.amount + entity.chargeAmount;
          update.accountingAmountBeforeFeeChf = entity.buyFiats[0].amountInChf / (1 - update.accountingFeePercent);
          update.accountingAmountAfterFeeChf = entity.buyFiats[0].amountInChf;
        }

        await this.bankTxRepo.update(entity.id, {
          accountingAmountBeforeFee: Util.roundReadable(entity.amount + entity.chargeAmount, AmountType.FIAT),
          accountingFeePercent: Util.roundReadable(update.accountingFeePercent, AmountType.FIAT),
          accountingFeeAmount: Util.roundReadable(update.accountingFeeAmount, AmountType.FIAT),
          accountingAmountAfterFee: Util.roundReadable(update.accountingAmountAfterFee, AmountType.FIAT),
          accountingAmountBeforeFeeChf: Util.roundReadable(update.accountingAmountBeforeFeeChf, AmountType.FIAT),
          accountingAmountAfterFeeChf: Util.roundReadable(update.accountingAmountAfterFeeChf, AmountType.FIAT),
        });
      } catch (e) {
        this.logger.error(`Error during bankTx ${entity.id} fill:`, e);
      }
    }
  }

  async create(bankTx: Partial<BankTx>, multiAccounts: SpecialExternalAccount[]): Promise<Partial<BankTx>> {
    let entity = await this.bankTxRepo.findOneBy({ accountServiceRef: bankTx.accountServiceRef });
    if (entity)
      throw new ConflictException(`There is already a bank tx with the accountServiceRef: ${bankTx.accountServiceRef}`);

    entity = this.createTx(bankTx, multiAccounts);

    entity.transaction = await this.transactionService.create({ sourceType: TransactionSourceType.BANK_TX });

    return this.bankTxRepo.save(entity);
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOne({
      where: { id: bankTxId },
      relations: {
        transaction: true,
        buyFiats: { transaction: { user: { userData: true } } },
        buyCryptoChargeback: { transaction: { user: { userData: true } } },
      },
    });
    if (!bankTx) throw new NotFoundException('BankTx not found');
    return this.updateInternal(bankTx, dto);
  }

  async updateInternal(bankTx: BankTx, dto: UpdateBankTxDto, user?: User): Promise<BankTx> {
    if (dto.type && dto.type != bankTx.type) {
      if (BankTxTypeCompleted(bankTx.type)) throw new ConflictException('BankTx type already set');

      switch (dto.type) {
        case BankTxType.BUY_CRYPTO:
          if (bankTx.creditDebitIndicator === BankTxIndicator.DEBIT)
            throw new BadRequestException('DBIT BankTx cannot set to buyCrypto type');
          await this.buyCryptoService.createFromBankTx(bankTx, dto.buyId);
          break;
        case BankTxType.BANK_TX_RETURN:
          bankTx.bankTxReturn = await this.bankTxReturnService.create(bankTx);
          break;
        case BankTxType.BANK_TX_REPEAT:
          await this.bankTxRepeatService.create(bankTx);
          break;
        default:
          if (dto.type)
            await this.transactionService.updateInternal(bankTx.transaction, {
              type: TransactionBankTxTypeMapper[dto.type],
              user: user ?? bankTx.user,
              userData: user?.userData ?? bankTx.user?.userData,
            });
          break;
      }
    }

    return this.bankTxRepo.save({ ...bankTx, ...dto });
  }

  async reset(id: number): Promise<void> {
    const bankTx = await this.bankTxRepo.findOne({ where: { id }, relations: { buyCrypto: true } });
    if (!bankTx) throw new NotFoundException('BankTx not found');
    if (!bankTx.buyCrypto) throw new BadRequestException('Only buyCrypto bankTx can be reset');
    if (bankTx.buyCrypto.isComplete) throw new BadRequestException('BuyCrypto already completed');

    await this.buyCryptoService.delete(bankTx.buyCrypto);
    await this.bankTxRepo.update(...bankTx.reset());
  }

  async getBankTxByKey(key: string, value: any, onlyDefaultRelation = false): Promise<BankTx> {
    const query = this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .leftJoinAndSelect('bankTx.buyCrypto', 'buyCrypto')
      .leftJoinAndSelect('buyCrypto.buy', 'buy')
      .leftJoinAndSelect('buy.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('bankTx.buyFiats', 'buyFiats')
      .leftJoinAndSelect('buyFiats.sell', 'sell')
      .leftJoinAndSelect('sell.user', 'sellUser')
      .leftJoinAndSelect('sellUser.userData', 'sellUserData')
      .where(`${key.includes('.') ? key : `bankTx.${key}`} = :param`, { param: value });

    if (!onlyDefaultRelation) {
      query
        .leftJoinAndSelect('userData.users', 'users')
        .leftJoinAndSelect('users.wallet', 'wallet')
        .leftJoinAndSelect('sellUserData.users', 'sellUsers')
        .leftJoinAndSelect('sellUsers.wallet', 'sellUsersWallet')
        .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
        .leftJoinAndSelect('userData.country', 'country')
        .leftJoinAndSelect('userData.nationality', 'nationality')
        .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
        .leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry')
        .leftJoinAndSelect('userData.language', 'language');
    }

    return query.getOne();
  }

  async getBankTxByRemittanceInfo(remittanceInfo: string): Promise<BankTx> {
    return this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx', 'bankTx')
      .leftJoinAndSelect('bankTx.transaction', 'transaction')
      .where(`REPLACE(bankTx.remittanceInfo, ' ', '') = :remittanceInfo`, {
        remittanceInfo: remittanceInfo.replace(/ /g, ''),
      })
      .orderBy('bankTx.id', 'DESC')
      .getOne();
  }

  async getBankTxByTransactionId(transactionId: number, relations?: FindOptionsRelations<BankTx>): Promise<BankTx> {
    return this.bankTxRepo.findOne({ where: { transaction: { id: transactionId } }, relations });
  }

  async getBankTxById(id: number): Promise<BankTx> {
    return this.bankTxRepo.findOneBy({ id });
  }

  async getPendingTx(): Promise<BankTx[]> {
    return this.bankTxRepo.findBy([
      { type: IsNull(), creditDebitIndicator: BankTxIndicator.CREDIT },
      {
        type: In([BankTxType.PENDING, BankTxType.UNKNOWN, BankTxType.GSHEET]),
        creditDebitIndicator: BankTxIndicator.CREDIT,
      },
    ]);
  }

  async getBankTxFee(from: Date): Promise<number> {
    const { fee } = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('SUM(chargeAmountChf)', 'fee')
      .where('created >= :from', { from })
      .getRawOne<{ fee: number }>();

    return fee ?? 0;
  }

  async getRecentBankToBankTx(fromIban: string, toIban: string): Promise<BankTx[]> {
    return this.bankTxRepo.findBy([
      { iban: toIban, accountIban: fromIban, id: MoreThan(130100) },
      { iban: fromIban, accountIban: toIban, id: MoreThan(130100) },
    ]);
  }

  async getRecentExchangeTx(minId: number, type: BankTxType): Promise<BankTx[]> {
    return this.bankTxRepo.findBy({
      id: minId ? MoreThanOrEqual(minId) : undefined,
      type,
      created: !minId ? MoreThan(Util.daysBefore(21)) : undefined,
    });
  }

  async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = this.sepaParser.parseSepaFile(xmlFile);

    const multiAccounts = await this.specialAccountService.getMultiAccounts();

    // parse the file
    let batch = this.bankTxBatchRepo.create(this.sepaParser.parseBatch(sepaFile));
    const txList = await this.sepaParser
      .parseEntries(sepaFile, batch.iban)
      .then((l) => l.map((e) => this.createTx(e, multiAccounts)));

    // find duplicate entries
    const duplicates = await this.bankTxRepo
      .findBy({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      const message = `Duplicate SEPA entries found in batch ${batch.identification}: ${duplicates}`;
      this.logger.error(message);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.SEPA,
        input: { subject: 'SEPA Error', errors: [message] },
      });
    }

    let newTxs = txList
      .filter((i) => !duplicates.includes(i.accountServiceRef))
      .map((tx) => {
        tx.type = this.getType(tx);
        tx.batch = batch;

        return tx;
      });

    for (const tx of newTxs) {
      tx.transaction = await this.transactionService.create({ sourceType: TransactionSourceType.BANK_TX });
    }

    // store batch and entries in one transaction
    await this.bankTxBatchRepo.manager.transaction(async (manager) => {
      batch = await manager.save(batch);
      newTxs = await new BankTxRepository(manager).saveMany(newTxs, 1000, 20);
    });

    // update bank liq balance
    const bank = await this.bankService.getBankByIban(batch.iban);
    this.bankBalanceSubject.next({ bank, balance: batch.bankBalanceAfter });

    // avoid infinite loop in JSON
    batch.transactions = newTxs.map((tx) => {
      tx.batch = null;
      return tx;
    });

    return batch;
  }

  private getType(tx: BankTx): BankTxType | null {
    if (tx.name?.includes('Payward Ltd.')) {
      return BankTxType.KRAKEN;
    }

    return null;
  }

  async getUnassignedBankTx(
    accounts: string[],
    relations: FindOptionsRelations<BankTx> = { transaction: true },
  ): Promise<BankTx[]> {
    return this.bankTxRepo.find({
      where: {
        type: In(BankTxUnassignedTypes),
        senderAccount: In(accounts),
        creditDebitIndicator: BankTxIndicator.CREDIT,
      },
      relations,
    });
  }

  async checkAssignAndNotifyUserData(iban: string, userData: UserData): Promise<void> {
    const bankTxs = await this.getUnassignedBankTx([iban], { transaction: { userData: true } });

    for (const bankTx of bankTxs) {
      if (bankTx.transaction.userData) continue;

      await this.transactionService.updateInternal(bankTx.transaction, { userData });
    }
  }

  private createTx(entity: DeepPartial<BankTx>, multiAccounts: SpecialExternalAccount[]): BankTx {
    const tx = this.bankTxRepo.create(entity);
    tx.senderAccount = tx.getSenderAccount(multiAccounts);
    return tx;
  }

  //*** GETTERS ***//

  getBankTxRepo(): BankTxRepository {
    return this.bankTxRepo;
  }

  get bankBalanceObservable(): Observable<BankBalanceUpdate> {
    return this.bankBalanceSubject.asObservable();
  }
}
