import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType, BankTxTypeCompleted } from './bank-tx.entity';
import { Interval } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { FrickService } from './frick.service';
import { OlkypayService } from './olkypay.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { BankTxReturnService } from '../bank-tx-return/bank-tx-return.service';
import { BankTxRepeatService } from '../bank-tx-repeat/bank-tx-repeat.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';

@Injectable()
export class BankTxService {
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
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Interval(60000)
  async checkTransactions(): Promise<void> {
    try {
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
          if (!(e instanceof ConflictException)) console.error(`Failed to import transaction:`, e);
        }
      }

      if (frickTransactions.length > 0) await this.settingService.set(settingKeyFrick, newModificationTime);
      if (olkyTransactions.length > 0) await this.settingService.set(settingKeyOlky, newModificationTime);
    } catch (e) {
      console.error(`Failed to check bank transactions:`, e);
    }
  }

  async create(bankTx: Partial<BankTx>): Promise<Partial<BankTx>> {
    let entity = await this.bankTxRepo.findOneBy({ accountServiceRef: bankTx.accountServiceRef });
    if (entity)
      throw new ConflictException(`There is already a bank tx with the accountServiceRef: ${bankTx.accountServiceRef}`);

    entity = await this.bankTxRepo.create(bankTx);
    return this.bankTxRepo.save(entity);
  }

  async storeSepaFiles(files: string[]): Promise<(BankTxBatch | Error)[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f).catch((e: Error) => e)));
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

  // --- HELPER METHODS --- //

  private async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // parse the file
    const batch = this.bankTxBatchRepo.create(SepaParser.parseBatch(sepaFile));
    const txList = this.bankTxRepo.create(SepaParser.parseEntries(sepaFile, batch.iban));

    // find duplicate entries
    const duplicates = await this.bankTxRepo
      .findBy({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      const message = `Duplicate SEPA entries found in batch ${batch.identification}:`;
      console.log(message, duplicates);

      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: { subject: 'SEPA Error', errors: [message + ` ${duplicates.join(', ')}`] },
      });
    }

    const newTxs = txList
      .filter((i) => !duplicates.includes(i.accountServiceRef))
      .map((tx) => ({
        type: tx.name?.includes('DFX AG') || tx.name?.includes('Payward Ltd.') ? BankTxType.INTERNAL : null,
        batch: batch,
        ...tx,
      }));

    // store batch and entries in one transaction
    await this.bankTxBatchRepo.manager.transaction(async (manager) => {
      await manager.save(batch);
      await manager.getCustomRepository(BankTxRepository).saveMany(newTxs);
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
