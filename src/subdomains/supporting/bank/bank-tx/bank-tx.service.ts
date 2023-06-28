import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { In, IsNull } from 'typeorm';
import { BankTxRepeatService } from '../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../bank-tx-return/bank-tx-return.service';
import { BankTxBatch } from './bank-tx-batch.entity';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTx, BankTxType, BankTxTypeCompleted } from './bank-tx.entity';
import { BankTxRepository } from './bank-tx.repository';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { FrickService } from './frick.service';
import { OlkypayService } from './olkypay.service';
import { SepaParser } from './sepa-parser.service';

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
    private readonly frickService: FrickService,
    private readonly olkyService: OlkypayService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankTxRepeatService: BankTxRepeatService,
    private readonly buyService: BuyService,
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(3600)
  async checkBankTx(): Promise<void> {
    await this.checkTransactions();
    await this.assignTransactions();
  }

  async checkTransactions(): Promise<void> {
    if (Config.processDisabled(Process.BANK_TX)) return;

    // Get settings
    const settingKeyFrick = 'lastBankFrickDate';
    const settingKeyOlky = 'lastBankOlkyDate';
    const lastModificationTimeFrick = await this.settingService.get(settingKeyFrick, new Date(0).toISOString());
    const lastModificationTimeOlky = await this.settingService.get(settingKeyOlky, new Date(0).toISOString());
    const newModificationTime = new Date().toISOString();

    // Get bank transactions
    const frickTransactions = await this.frickService.getFrickTransactions(lastModificationTimeFrick);
    const olkyTransactions = await this.olkyService.getOlkyTransactions(lastModificationTimeOlky);
    const allTransactions = olkyTransactions.concat(frickTransactions);

    for (const bankTx of allTransactions) {
      try {
        await this.create(bankTx);
      } catch (e) {
        if (!(e instanceof ConflictException)) this.logger.error(`Failed to import transaction:`, e);
      }
    }

    if (frickTransactions.length > 0) await this.settingService.set(settingKeyFrick, newModificationTime);
    if (olkyTransactions.length > 0) await this.settingService.set(settingKeyOlky, newModificationTime);
  }

  async assignTransactions() {
    const unassignedBankTx = await this.bankTxRepo.find({ where: { type: IsNull() } });

    for (const tx of unassignedBankTx) {
      const match = Config.formats.bankUsage.exec(tx.remittanceInfo);

      if (match) {
        const buy = await this.buyService.getByBankUsage(match[0]);
        if (buy) await this.update(tx.id, { type: BankTxType.BUY_CRYPTO, buyId: buy.id });
      }
    }
  }

  async create(bankTx: Partial<BankTx>): Promise<Partial<BankTx>> {
    let entity = await this.bankTxRepo.findOneBy({ accountServiceRef: bankTx.accountServiceRef });
    if (entity)
      throw new ConflictException(`There is already a bank tx with the accountServiceRef: ${bankTx.accountServiceRef}`);

    entity = await this.bankTxRepo.create(bankTx);
    return this.bankTxRepo.save(entity);
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOneBy({ id: bankTxId });
    if (!bankTx) throw new NotFoundException('BankTx not found');
    if (dto.type && dto.type != bankTx.type) {
      if (BankTxTypeCompleted(bankTx.type)) throw new ConflictException('BankTx type already set');

      switch (dto.type) {
        case BankTxType.BUY_CRYPTO:
          await this.buyCryptoService.createFromFiat(bankTxId, dto.buyId);
          break;
        case BankTxType.BANK_TX_RETURN:
          await this.bankTxReturnService.create(bankTx);
          break;
        case BankTxType.BANK_TX_REPEAT:
          await this.bankTxRepeatService.create(bankTx);
          break;
      }
    }

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
      .leftJoinAndSelect('sellUserData.users', 'sellUsers')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .leftJoinAndSelect('sellUsers.wallet', 'sellUsersWallet')
      .where(`bankTx.${key} = :param`, { param: value })
      .getOne();
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
        tx.type = tx.name?.includes('DFX AG') || tx.name?.includes('Payward Ltd.') ? BankTxType.INTERNAL : null;
        tx.batch = batch;

        return tx;
      });

    // store batch and entries in one transaction
    await this.bankTxBatchRepo.manager.transaction(async (manager) => {
      batch = await manager.save(batch);
      newTxs = await new BankTxRepository(manager).saveMany(newTxs);
    });

    // avoid infinite loop in JSON
    batch.transactions = newTxs.map((tx) => {
      tx.batch = null;
      return tx;
    });

    return batch;
  }

  //*** GETTERS ***//

  getBankTxRepo(): BankTxRepository {
    return this.bankTxRepo;
  }
}
