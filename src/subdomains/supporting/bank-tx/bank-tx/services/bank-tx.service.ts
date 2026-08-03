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
import { Config } from 'src/config/config';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
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
import { TransactionNotificationService } from 'src/subdomains/supporting/payment/services/transaction-notification.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import {
  DeepPartial,
  FindOptionsRelations,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import { OlkypayService } from '../../../../../integration/bank/services/olkypay.service';
import { BankService } from '../../../bank/bank/bank.service';
import { VirtualIbanService } from '../../../bank/virtual-iban/virtual-iban.service';
import {
  Transaction,
  TransactionSourceType,
  TransactionTypeInternal,
} from '../../../payment/entities/transaction.entity';
import { SpecialExternalAccountService } from '../../../payment/services/special-external-account.service';
import { TransactionService } from '../../../payment/services/transaction.service';
import { BankTxRepeatService } from '../../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx-return/bank-tx-return.service';
import { UpdateBankTxDto } from '../dto/update-bank-tx.dto';
import { BankTxBatch } from '../entities/bank-tx-batch.entity';
import {
  BankTx,
  BankTxComplianceSearchableTypes,
  BankTxIndicator,
  BankTxType,
  BankTxTypeCompleted,
  BankTxTypeUnassigned,
  BankTxUnassignedTypes,
} from '../entities/bank-tx.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';
import { BankTxRepository } from '../repositories/bank-tx.repository';
import { BankTxFrickService } from './bank-tx-frick.service';
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
  [BankTxType.SCRYPT]: TransactionTypeInternal.SCRYPT,
  [BankTxType.SCB]: TransactionTypeInternal.SCB,
  [BankTxType.CHECKOUT_LTD]: TransactionTypeInternal.CHECKOUT_LTD,
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

  private olkyUnavailableWarningLogged = false;

  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    @Inject(forwardRef(() => BuyCryptoService))
    private readonly buyCryptoService: BuyCryptoService,
    private readonly notificationService: NotificationService,
    private readonly settingService: SettingService,
    private readonly olkyService: OlkypayService,
    private readonly frickTxService: BankTxFrickService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly buyService: BuyService,
    private readonly bankService: BankService,
    private readonly yapealService: YapealService,
    @Inject(forwardRef(() => TransactionService))
    private readonly transactionService: TransactionService,
    private readonly specialAccountService: SpecialExternalAccountService,
    private readonly sepaParser: SepaParser,
    private readonly bankDataService: BankDataService,
    private readonly virtualIbanService: VirtualIbanService,
    @Inject(forwardRef(() => TransactionNotificationService))
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
  ) {}

  onModuleInit() {
    this.bankDataService.bankDataObservable.subscribe((dto) =>
      this.checkAssignAndNotifyUserData(dto.iban, dto.userData),
    );
  }

  // --- TRANSACTION HANDLING --- //
  @DfxCron(CronExpression.EVERY_30_SECONDS, { timeout: 3600, process: Process.BANK_TX })
  async checkBankTx(): Promise<void> {
    try {
      await this.checkTransactions();
    } catch (error) {
      this.logger.error('Failed to check Olkypay transactions:', error);
    }
    try {
      await this.frickTxService.checkTransactions(this.create.bind(this));
    } catch (error) {
      this.logger.error('Failed to check Bank Frick transactions:', error);
    }
    await this.assignTransactions();
    await this.fillBankTx();
  }

  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BANK_TX })
  async enrichYapealTransactions(): Promise<void> {
    const transactions = await this.bankTxRepo.find({
      where: { familyCode: 'CCRD' }, // credit card => wrong data
      order: { id: 'DESC' },
      take: 100,
    });

    if (transactions.length === 0) return;

    const ibanGroups = Util.groupBy<BankTx, string>(transactions, 'accountIban');

    for (const [accountIban, groupTransactions] of ibanGroups) {
      try {
        const dates = groupTransactions.map((tx) => (tx.bookingDate ?? tx.created).getTime());
        const fromDate = new Date(Math.min(...dates));
        const toDate = Util.daysAfter(1, new Date(Math.max(...dates)));

        const yapealTransactions = await this.yapealService.getTransactions(accountIban, fromDate, toDate);

        for (const transaction of groupTransactions) {
          const yapealTx = yapealTransactions.find((tx) => tx.accountServiceRef === transaction.accountServiceRef);
          if (yapealTx) {
            const enrichmentData = {
              addressLine1: yapealTx.addressLine1,
              addressLine2: yapealTx.addressLine2,
              country: yapealTx.country,
              domainCode: yapealTx.domainCode,
              familyCode: yapealTx.familyCode,
              subFamilyCode: yapealTx.subFamilyCode,
            };
            await this.bankTxRepo.update(transaction.id, Util.removeNullFields(enrichmentData));
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to enrich transactions for ${accountIban}:`, error);
      }
    }
  }

  private async checkTransactions(): Promise<void> {
    // Get settings
    const settingKeyOlky = 'lastBankOlkyDate';
    const lastModificationTimeOlky = await this.settingService.get(settingKeyOlky, new Date(0).toISOString());

    const newModificationTime = new Date().toISOString();

    const olkyBank = await this.bankService.getBankInternal(IbanBankName.OLKY, 'EUR');
    if (!olkyBank) {
      if (!this.olkyUnavailableWarningLogged) {
        this.logger.warn('Olky bank not configured - skipping checkTransactions');
        this.olkyUnavailableWarningLogged = true;
      }
      return;
    }

    // Get bank transactions
    const olkyTransactions = await this.olkyService.getOlkyTransactions(lastModificationTimeOlky, olkyBank.iban);

    const multiAccounts = await this.specialAccountService.getMultiAccounts();
    for (const transaction of olkyTransactions) {
      try {
        await this.create(transaction, multiAccounts);
      } catch (e) {
        if (!(e instanceof ConflictException)) this.logger.error(`Failed to import transaction:`, e);
      }
    }

    if (olkyTransactions.length > 0) await this.settingService.set(settingKeyOlky, newModificationTime);
  }

  private async assignTransactions(): Promise<void> {
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
        const detectedType = await this.getType(tx);
        if (detectedType === BankTxType.INTERNAL) {
          await this.classifyKnownTypeIfAssignable(tx);
          continue;
        }

        if (tx.creditDebitIndicator === BankTxIndicator.CREDIT) {
          // check for dedicated asset vIBAN
          if (tx.virtualIban) {
            const virtualIban = await this.virtualIbanService.getByIban(tx.virtualIban);
            if (virtualIban?.buy) {
              await this.updateInternal(tx, { type: BankTxType.BUY_CRYPTO, buyId: virtualIban.buy.id });
              continue;
            }
          }

          // match by remittance info (bankUsage)
          const buy = this.findMatchingBuy(tx, buys);

          if (buy) {
            await this.updateInternal(tx, { type: BankTxType.BUY_CRYPTO, buyId: buy.id });

            continue;
          }
        }

        if (await this.bankTxRepo.existsBy({ id: tx.id, type: Not(IsNull()) })) continue;

        await this.updateInternal(tx, { type: detectedType ?? BankTxType.GSHEET });
      } catch (e) {
        this.logger.error(`Error during bankTx ${tx.id} assign:`, e);
      }
    }
  }

  async classifyKnownTypeIfAssignable(bankTx: BankTx): Promise<BankTx | undefined> {
    return this.bankTxRepo.manager.transaction(async (manager) => {
      const currentBankTx = await manager.findOne(BankTx, {
        where: { id: bankTx.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!currentBankTx || !currentBankTx.transactionId) return undefined;

      const detectedType = await this.getType(currentBankTx);

      const isAssignable =
        currentBankTx.type === null || currentBankTx.type === undefined || BankTxTypeUnassigned(currentBankTx.type);
      if (!detectedType) return isAssignable ? currentBankTx : undefined;
      if (!isAssignable && currentBankTx.type !== detectedType) return undefined;

      const currentTransaction = await manager.findOne(Transaction, {
        where: { id: currentBankTx.transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      const transactionType = TransactionBankTxTypeMapper[detectedType];
      if (
        !currentTransaction ||
        (currentTransaction.type !== null &&
          currentTransaction.type !== undefined &&
          currentTransaction.type !== transactionType)
      )
        return undefined;

      if (currentTransaction.type !== transactionType)
        await manager.update(Transaction, currentTransaction.id, { type: transactionType });
      const isInternalTransfer = detectedType === BankTxType.INTERNAL;
      if (currentBankTx.type !== detectedType || (isInternalTransfer && !currentBankTx.isInternalTransfer)) {
        const update: Partial<BankTx> = { type: detectedType };
        if (isInternalTransfer) update.isInternalTransfer = true;
        await manager.update(BankTx, currentBankTx.id, update);
      }

      return Object.assign(currentBankTx, {
        type: detectedType,
        isInternalTransfer: Boolean(isInternalTransfer || currentBankTx.isInternalTransfer),
        transaction: currentTransaction,
      });
    });
  }

  private async fillBankTx(): Promise<void> {
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
        // The matcher (BankTxOutgoingMatchService) treats a DEBIT row's `amount` as already
        // charge-inclusive/gross (net-of-charge matching subtracts chargeAmount from it) - accounting
        // must use the same convention instead of adding the charge back on top, or a charged Frick
        // payout is double-counted. A CREDIT row's `amount` is charge-exclusive as received (the charge
        // was already deducted before it arrived), so it still needs chargeAmount added back to recover
        // the original, pre-charge amount - unchanged from before this PR.
        const accountingCharge = entity.creditDebitIndicator === BankTxIndicator.CREDIT ? entity.chargeAmount : 0;

        if (![BankTxType.BUY_CRYPTO, BankTxType.BUY_FIAT].includes(entity.type)) {
          await this.bankTxRepo.update(entity.id, {
            accountingAmountBeforeFee: Util.roundReadable(entity.amount + accountingCharge, AmountType.FIAT),
          });
          continue;
        }
        if (!entity.buyCrypto && !entity.buyFiats?.length) continue;

        const update: Partial<BankTx> = {};

        if (entity.type === BankTxType.BUY_CRYPTO) {
          update.accountingFeePercent = entity.buyCrypto.percentFee;
          update.accountingFeeAmount = update.accountingFeePercent * (entity.amount + accountingCharge);
          update.accountingAmountAfterFee = entity.amount + accountingCharge - update.accountingFeeAmount;
          update.accountingAmountBeforeFeeChf = entity.buyCrypto.amountInChf;
          update.accountingAmountAfterFeeChf = entity.buyCrypto.amountInChf * (1 - update.accountingFeePercent);
        } else {
          update.accountingFeePercent = entity.buyFiats[0].percentFee;
          update.accountingFeeAmount =
            update.accountingFeePercent * ((entity.amount + accountingCharge) / (1 - update.accountingFeePercent));
          update.accountingAmountAfterFee = entity.amount + accountingCharge;
          update.accountingAmountBeforeFeeChf = entity.buyFiats[0].amountInChf / (1 - update.accountingFeePercent);
          update.accountingAmountAfterFeeChf = entity.buyFiats[0].amountInChf;
        }

        await this.bankTxRepo.update(entity.id, {
          accountingAmountBeforeFee: Util.roundReadable(entity.amount + accountingCharge, AmountType.FIAT),
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
    entity.type = await this.getType(entity);
    entity.isInternalTransfer = entity.type === BankTxType.INTERNAL;

    entity.transaction = await this.transactionService.create({
      sourceType: TransactionSourceType.BANK_TX,
      type: TransactionBankTxTypeMapper[entity.type] ?? undefined,
    });

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
    if (
      dto.type === BankTxType.INTERNAL &&
      !bankTx.isInternalTransfer &&
      (await this.bankService.areKnownBankIbans(bankTx.accountIban, bankTx.iban))
    )
      bankTx.isInternalTransfer = true;

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
      .leftJoinAndSelect('bankTx.transaction', 'transaction')
      .leftJoinAndSelect('transaction.userData', 'userData')
      .where(`${key.includes('.') ? key : `bankTx.${key}`} = :param`, { param: value });

    if (!onlyDefaultRelation) {
      query
        .leftJoinAndSelect('userData.users', 'users')
        .leftJoinAndSelect('users.wallet', 'wallet')
        .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
        .leftJoinAndSelect('userData.country', 'country')
        .leftJoinAndSelect('userData.nationality', 'nationality')
        .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
        .leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry')
        .leftJoinAndSelect('userData.language', 'language');
    }

    return query.getOne();
  }

  async getBankTxByTransactionId(transactionId: number, relations?: FindOptionsRelations<BankTx>): Promise<BankTx> {
    return this.bankTxRepo.findOne({ where: { transaction: { id: transactionId } }, relations });
  }

  async getBankTxsByTransactionIds(transactionIds: number[]): Promise<BankTx[]> {
    if (!transactionIds.length) return [];
    return this.bankTxRepo.find({
      where: { transaction: { id: In(transactionIds) } },
      relations: { transaction: true },
    });
  }

  async getBankTxById(id: number, relations?: FindOptionsRelations<BankTx>): Promise<BankTx> {
    return this.bankTxRepo.findOne({ where: { id }, relations });
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

  // Bank fees come from three sources: (1) legacy per-tx charges (chargeAmountChf); (2) dedicated BankAccountFee
  // rows; (3) statement-inline charges (e.g. Bank Frick camt) that carry chargeAmount without a CHF conversion.
  // Charge fields ceased with the bank migration in Dec 2025; fees arrive as dedicated BankAccountFee rows since,
  // carrying the amount in the account currency (no amountChf column), so they are aggregated per currency and
  // converted to CHF.
  async getBankTxFee(from: Date): Promise<number> {
    const { fee } = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('SUM(bankTx.chargeAmountChf)', 'fee')
      .where('bankTx.created >= :from', { from })
      .getRawOne<{ fee: number }>();

    let totalFeeChf = fee ?? 0;

    // Aggregate the dedicated BankAccountFee rows in the database (summed per currency and direction)
    // rather than hydrating every row: this runs every minute from the financial-log cron and the table
    // grows continuously. Column references use the alias.property form so TypeORM quotes the camelCase
    // identifiers correctly for Postgres.
    const feeAggregates = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx.currency', 'currency')
      .addSelect('bankTx.creditDebitIndicator', 'creditDebitIndicator')
      .addSelect('SUM(bankTx.amount)', 'amount')
      .where('bankTx.type = :type', { type: BankTxType.BANK_ACCOUNT_FEE })
      .andWhere('bankTx.created >= :from', { from })
      .groupBy('bankTx.currency')
      .addGroupBy('bankTx.creditDebitIndicator')
      .getRawMany<{ currency: string; creditDebitIndicator: string; amount: string }>();

    const amountByCurrency = new Map<string, number>();
    for (const row of feeAggregates) {
      const groupAmount = Number(row.amount);

      let signedAmount: number;
      if (row.creditDebitIndicator === BankTxIndicator.DEBIT) {
        signedAmount = groupAmount;
      } else if (row.creditDebitIndicator === BankTxIndicator.CREDIT) {
        signedAmount = -groupAmount;
      } else {
        this.logger.error(
          `BankAccountFee aggregate (currency ${row.currency}) has unexpected creditDebitIndicator ${row.creditDebitIndicator}, skipping`,
        );
        continue;
      }

      amountByCurrency.set(row.currency, (amountByCurrency.get(row.currency) ?? 0) + signedAmount);
    }

    for (const [currency, amount] of amountByCurrency) {
      if (!amount) continue;

      const fiat = await this.fiatService.getFiatByName(currency);
      const price = await this.pricingService.getPrice(fiat, PriceCurrency.CHF, PriceValidity.ANY);
      totalFeeChf += price.convert(amount, Config.defaultVolumeDecimal);
    }

    // source 3 = statement-inline charges (e.g. Bank Frick camt) that carry chargeAmount without a CHF conversion.
    // They set chargeAmount + chargeCurrency but never chargeAmountChf, and their type is null (or later a non-fee
    // type), so they fall through sources 1 and 2. The `type IS NULL OR type != :feeType` form is required because
    // Postgres evaluates `NULL != 'x'` to UNKNOWN, which would silently drop exactly the type=null inline charges
    // this must capture. Column references use the alias.property form so TypeORM quotes the camelCase identifiers
    // correctly for Postgres.
    const inlineChargeAggregates = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx.chargeCurrency', 'currency')
      .addSelect('SUM(bankTx.chargeAmount)', 'amount')
      .where('bankTx.chargeAmount != 0')
      .andWhere('bankTx.chargeAmountChf IS NULL')
      .andWhere('(bankTx.type IS NULL OR bankTx.type != :feeType)', { feeType: BankTxType.BANK_ACCOUNT_FEE })
      .andWhere('bankTx.created >= :from', { from })
      .groupBy('bankTx.chargeCurrency')
      .getRawMany<{ currency: string; amount: string }>();

    for (const row of inlineChargeAggregates) {
      const fiat = await this.fiatService.getFiatByName(row.currency);
      const price = await this.pricingService.getPrice(fiat, PriceCurrency.CHF, PriceValidity.ANY);
      totalFeeChf += price.convert(Number(row.amount), Config.defaultVolumeDecimal);
    }

    return Util.round(totalFeeChf, Config.defaultVolumeDecimal);
  }

  async getTrackedInternalTransfers(): Promise<BankTx[]> {
    return this.bankTxRepo.findBy({ type: BankTxType.INTERNAL, isInternalTransfer: true });
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

    let newTxs = await Promise.all(
      txList
        .filter((i) => !duplicates.includes(i.accountServiceRef))
        .map(async (tx) => {
          tx.type = await this.getType(tx);
          tx.isInternalTransfer = tx.type === BankTxType.INTERNAL;
          tx.batch = batch;

          return tx;
        }),
    );

    for (const tx of newTxs) {
      tx.transaction = await this.transactionService.create({
        sourceType: TransactionSourceType.BANK_TX,
        type: TransactionBankTxTypeMapper[tx.type] ?? undefined,
      });
    }

    // store batch and entries in one transaction
    await this.bankTxBatchRepo.manager.transaction(async (manager) => {
      batch = await manager.save(batch);
      newTxs = await new BankTxRepository(manager).saveMany(newTxs, 1000, 20);
    });

    // update bank liq balance
    const bank = await this.bankService.getBankByIban(batch.iban);
    this.bankBalanceSubject.next({ bank, iban: batch.iban, balance: batch.bankBalanceAfter });

    // avoid infinite loop in JSON
    batch.transactions = newTxs.map((tx) => {
      tx.batch = null;
      return tx;
    });

    return batch;
  }

  async getType(tx: BankTx): Promise<BankTxType | null> {
    if (await this.bankService.areKnownBankIbans(tx.accountIban, tx.iban)) {
      return BankTxType.INTERNAL;
    }

    if (tx.name?.includes('Payward Trading')) {
      return BankTxType.KRAKEN;
    }

    if (tx.name?.includes('Scrypt Digital Trading')) {
      return BankTxType.SCRYPT;
    }

    if (tx.name?.includes('SCB AG')) {
      return BankTxType.SCB;
    }

    return null;
  }

  async getUnassignedBankTx(
    accounts: string[],
    virtualIbans: string[],
    relations: FindOptionsRelations<BankTx> = { transaction: true },
    types: BankTxType[] = BankTxUnassignedTypes,
  ): Promise<BankTx[]> {
    const request: FindOptionsWhere<BankTx> = {
      type: In(types),
      creditDebitIndicator: BankTxIndicator.CREDIT,
    };

    return this.bankTxRepo.find({
      where: [
        { ...request, senderAccount: In(accounts) },
        { ...request, virtualIban: In(virtualIbans) },
      ],
      relations,
    });
  }

  async getBankTxsByVirtualIban(virtualIban: string): Promise<BankTx[]> {
    return this.bankTxRepo.find({
      where: { virtualIban },
      relations: { transaction: { userData: true } },
    });
  }

  async getBankTxsByName(name: string): Promise<BankTx[]> {
    const request: FindOptionsWhere<BankTx> = {
      type: In(BankTxComplianceSearchableTypes),
      creditDebitIndicator: BankTxIndicator.CREDIT,
    };

    const wheres: FindOptionsWhere<BankTx>[] = [
      { ...request, name: Like(`%${name}%`) },
      { ...request, ultimateName: Like(`%${name}%`) },
    ];

    const nameParts = name
      .split(' ')
      .filter((p) => p)
      .slice(0, 5);
    const namePartsWithoutTitles = nameParts.filter((p) => !p.endsWith('.'));

    const splitVariants = [nameParts];
    if (namePartsWithoutTitles.length < nameParts.length && namePartsWithoutTitles.length >= 2)
      splitVariants.push(namePartsWithoutTitles);

    for (const parts of splitVariants) {
      // full-string search for title-filtered variant (e.g. "John Peter Doe" without "Dr.")
      const joined = parts.join(' ');
      if (joined !== name) {
        wheres.push({ ...request, name: Like(`%${joined}%`) }, { ...request, ultimateName: Like(`%${joined}%`) });
      }

      // reversed splits (e.g. "Doe John" for input "John Doe")
      for (let i = 1; i < parts.length && i < 5; i++) {
        const firstPart = parts.slice(0, i).join(' ');
        const lastPart = parts.slice(i).join(' ');
        const reversed = `${lastPart} ${firstPart}`;

        wheres.push({ ...request, name: Like(`%${reversed}%`) }, { ...request, ultimateName: Like(`%${reversed}%`) });
      }
    }

    return this.bankTxRepo.find({
      where: wheres,
      relations: { transaction: true },
    });
  }

  async checkAssignAndNotifyUserData(iban: string, userData: UserData): Promise<void> {
    const bankTxs = await this.getUnassignedBankTx([iban], [], { transaction: { userData: true } });

    for (const bankTx of bankTxs) {
      if (bankTx.transaction.userData) continue;

      await this.transactionService.updateInternal(bankTx.transaction, { userData });

      await this.transactionNotificationService.sendUnassignedTxMail(bankTx.transaction, userData);
    }
  }

  private createTx(entity: DeepPartial<BankTx>, multiAccounts: SpecialExternalAccount[]): BankTx {
    const tx = this.bankTxRepo.create(entity);
    tx.senderAccount = tx.getSenderAccount(multiAccounts);
    return tx;
  }

  private findMatchingBuy(tx: BankTx, buys: { id: number; bankUsage: string }[]): { id: number } | undefined {
    // Try remittanceInfo first, then endToEndId as fallback
    const candidates = [tx.remittanceInfo, tx.endToEndId].filter((c) => c && c !== '-');

    for (const candidate of candidates) {
      const normalized = candidate.replace(/[ -]/g, '').toUpperCase().replace(/O/g, '0');
      const buy = buys.find((b) => normalized.includes(b.bankUsage.replace(/-/g, '')));
      if (buy) return buy;
    }

    return undefined;
  }

  //*** GETTERS ***//

  getBankTxRepo(): BankTxRepository {
    return this.bankTxRepo;
  }

  get bankBalanceObservable(): Observable<BankBalanceUpdate> {
    return this.bankBalanceSubject.asObservable();
  }

  async getUserDataForBankTx(bankTx: BankTx, userDataId?: number, ibansOnly = true): Promise<UserData | undefined> {
    // Priority 1: VirtualIban (mandatory if set)
    if (bankTx.virtualIban) return this.virtualIbanService.getByIban(bankTx.virtualIban).then((vI) => vI?.userData);

    // Priority 2: BankData via senderAccount (fallback)
    if (bankTx.senderAccount) {
      return userDataId
        ? this.bankDataService
            .getValidBankDatasForUser(userDataId, ibansOnly, bankTx.senderAccount)
            .then((b) => b?.[0]?.userData)
        : this.bankDataService
            .getVerifiedBankDataWithIban(
              bankTx.senderAccount,
              undefined,
              undefined,
              { userData: { wallet: true } },
              true,
            )
            .then((b) => b?.userData);
    }

    return undefined;
  }
}
