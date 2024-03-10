import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { RevolutService } from 'src/integration/bank/services/revolut.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, IsNull } from 'typeorm';
import { OlkypayService } from '../../../../integration/bank/services/olkypay.service';
import { BankName } from '../../bank/bank/bank.entity';
import { BankService } from '../../bank/bank/bank.service';
import { TransactionSourceType, TransactionType } from '../../payment/entities/transaction.entity';
import { TransactionService } from '../../payment/services/transaction.service';
import { BankTxRepeatService } from '../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../bank-tx-return/bank-tx-return.service';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTx, BankTxType, BankTxTypeCompleted } from './bank-tx.entity';
import { BankTxRepository } from './bank-tx.repository';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { SepaParser } from './sepa-parser.service';

export const TransactionBankTxTypeMapper: {
  [key in BankTxType]: TransactionType;
} = {
  [BankTxType.INTERNAL]: TransactionType.INTERNAL,
  [BankTxType.BUY_CRYPTO_RETURN]: TransactionType.BUY_CRYPTO_RETURN,
  [BankTxType.BANK_TX_RETURN]: TransactionType.BANK_TX_RETURN,
  [BankTxType.BUY_CRYPTO]: TransactionType.BUY_CRYPTO,
  [BankTxType.BUY_FIAT]: TransactionType.BUY_FIAT,
  [BankTxType.BANK_TX_REPEAT]: TransactionType.BANK_TX_REPEAT,
  [BankTxType.BANK_TX_RETURN_CHARGEBACK]: null,
  [BankTxType.BANK_TX_REPEAT_CHARGEBACK]: null,
  [BankTxType.FIAT_FIAT]: null,
  [BankTxType.TEST_FIAT_FIAT]: null,
  [BankTxType.GSHEET]: null,
  [BankTxType.KRAKEN]: null,
  [BankTxType.CHECKOUT_LTD]: null,
  [BankTxType.REVOLUT_CARD_PAYMENT]: null,
  [BankTxType.BANK_ACCOUNT_FEE]: null,
  [BankTxType.EXTRAORDINARY_EXPENSES]: null,
  [BankTxType.PENDING]: null,
  [BankTxType.UNKNOWN]: null,
};

@Injectable()
export class BankTxService {
  private readonly logger = new DfxLogger(BankTxService);

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
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock(3600)
  async checkBankTx(): Promise<void> {
    await this.checkTransactions();
    await this.assignTransactions();
  }

  async checkTransactions(): Promise<void> {
    if (DisabledProcess(Process.BANK_TX)) return;

    // Get settings
    const settingKeyOlky = 'lastBankOlkyDate';
    const settingKeyRevolut = 'lastBankRevolutDate';
    const lastModificationTimeOlky = await this.settingService.get(settingKeyOlky, new Date(0).toISOString());
    const lastModificationTimeRevolut = await this.settingService.get(settingKeyRevolut, new Date(0).toISOString());

    const newModificationTime = new Date().toISOString();

    const olkyBank = await this.bankService.getBankInternal(BankName.OLKY, 'EUR');
    const revolutBank = await this.bankService.getBankInternal(BankName.REVOLUT, 'EUR');

    // Get bank transactions
    const olkyTransactions = await this.olkyService.getOlkyTransactions(lastModificationTimeOlky, olkyBank.iban);
    const revolutTransactions = await this.revolutService.getRevolutTransactions(
      lastModificationTimeRevolut,
      revolutBank.iban,
    );
    const allTransactions = olkyTransactions.concat(revolutTransactions);

    for (const transaction of allTransactions) {
      try {
        const bankTx = await this.create(transaction);
        if (!DisabledProcess(Process.CREATE_TRANSACTION))
          await this.transactionService.create({ sourceId: bankTx.id, sourceType: TransactionSourceType.BANK_TX });
      } catch (e) {
        if (!(e instanceof ConflictException)) this.logger.error(`Failed to import transaction:`, e);
      }
    }

    if (olkyTransactions.length > 0) await this.settingService.set(settingKeyOlky, newModificationTime);
    if (revolutTransactions.length > 0) await this.settingService.set(settingKeyRevolut, newModificationTime);
  }

  async assignTransactions() {
    const unassignedBankTx = await this.bankTxRepo.find({ where: { type: IsNull() } });

    for (const tx of unassignedBankTx) {
      const match = Config.formats.bankUsage.exec(tx.remittanceInfo);

      if (match) {
        const buy = await this.buyService.getByBankUsage(match[0]);

        if (buy) {
          await this.update(tx.id, { type: BankTxType.BUY_CRYPTO, buyId: buy.id });
          continue;
        }
      }
      await this.update(tx.id, { type: BankTxType.GSHEET });
    }
  }

  async create(bankTx: Partial<BankTx>): Promise<Partial<BankTx>> {
    let entity = await this.bankTxRepo.findOneBy({ accountServiceRef: bankTx.accountServiceRef });
    if (entity)
      throw new ConflictException(`There is already a bank tx with the accountServiceRef: ${bankTx.accountServiceRef}`);

    entity = this.bankTxRepo.create(bankTx);
    return this.bankTxRepo.save(entity);
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOneBy({ id: bankTxId });
    if (!bankTx) throw new NotFoundException('BankTx not found');
    if (dto.type && dto.type != bankTx.type) {
      if (BankTxTypeCompleted(bankTx.type)) throw new ConflictException('BankTx type already set');

      switch (dto.type) {
        case BankTxType.BUY_CRYPTO:
          await this.buyCryptoService.createFromBankTx(bankTx, dto.buyId);
          break;
        case BankTxType.BANK_TX_RETURN:
          await this.bankTxReturnService.create(bankTx);
          break;
        case BankTxType.BANK_TX_REPEAT:
          await this.bankTxRepeatService.create(bankTx);
          break;
        default:
          if (!DisabledProcess(Process.CREATE_TRANSACTION) && dto.type)
            await this.transactionService.update(bankTx.id, TransactionSourceType.BANK_TX, {
              type: TransactionBankTxTypeMapper[dto.type],
            });
          break;
      }
    }

    Util.removeNullFields(dto);

    return this.bankTxRepo.save({ ...bankTx, ...dto });
  }

  async getBankTxByKey(key: string, value: any): Promise<BankTx> {
    return this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .leftJoinAndSelect('bankTx.buyCrypto', 'buyCrypto')
      .leftJoinAndSelect('bankTx.buyFiat', 'buyFiat')
      .leftJoinAndSelect('buyCrypto.buy', 'buy')
      .leftJoinAndSelect('buyFiat.sell', 'sell')
      .leftJoinAndSelect('buy.user', 'user')
      .leftJoinAndSelect('sell.user', 'sellUser')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('sellUser.userData', 'sellUserData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('sellUserData.users', 'sellUsers')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .leftJoinAndSelect('sellUsers.wallet', 'sellUsersWallet')
      .where(`${key.includes('.') ? key : `bankTx.${key}`} = :param`, { param: value })
      .getOne();
  }

  async getBankTxWithoutTransaction(): Promise<BankTx[]> {
    return this.bankTxRepo.find({
      where: { transaction: IsNull() },
      relations: { transaction: true, buyCrypto: true, buyFiat: true, bankTxReturn: true, bankTxRepeat: true },
    });
  }

  async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // parse the file
    let batch = this.bankTxBatchRepo.create(SepaParser.parseBatch(sepaFile));
    const txList = this.bankTxRepo.create(SepaParser.parseEntries(sepaFile, batch.iban));

    // find duplicate entries
    const duplicates = await this.bankTxRepo
      .findBy({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      const message = `Duplicate SEPA entries found in batch ${batch.identification}: ${duplicates}`;
      this.logger.error(message);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
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

    // store batch and entries in one transaction
    await this.bankTxBatchRepo.manager.transaction(async (manager) => {
      batch = await manager.save(batch);
      newTxs = await new BankTxRepository(manager).saveMany(newTxs, 1000, 20);
    });

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

  //*** GETTERS ***//

  getBankTxRepo(): BankTxRepository {
    return this.bankTxRepo;
  }
}
