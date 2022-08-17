import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { MailService } from 'src/shared/services/mail.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType } from './bank-tx.entity';
import { BuyCryptoService } from '../buy-crypto/services/buy-crypto.service';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { FrickService } from './frick.service';
import { OlkypayService } from './olkypay.service';
@Injectable()
export class BankTxService {
  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly mailService: MailService,
    private readonly settingService: SettingService,
    private readonly frickService: FrickService,
    private readonly olkyService: OlkypayService,
    private readonly bankTxService: BankTxService,
  ) {}

  // --- TRANSACTION HANDLING --- //
  @Interval(10000)
  async checkTransactions(): Promise<void> {
    try {
      if (!Config.bank.frick.key) return;
      const settingKey = 'lastBankDate';
      const lastModificationTime = await this.settingService.get(settingKey, new Date(0).toISOString());

      const olkyTransactions = await this.olkyService.getOlkyTransactions(lastModificationTime);
      const frickTransactions = await this.frickService.getFrickTransactions(lastModificationTime);

      for (const bankTx of [...frickTransactions, ...olkyTransactions]) {
        try {
          await this.bankTxService.create(bankTx);
        } catch (e) {
          if (!(e instanceof ConflictException)) console.error(`Failed to import transaction:`, e);
        }
      }

      const newModificationTime = new Date().toISOString();
      await this.settingService.set(settingKey, newModificationTime);
    } catch (e) {
      console.error(`Failed to check olkypay transactions:`, e);
    }
  }

  async create(bankTx: Partial<BankTx>): Promise<Partial<BankTx>> {
    let entity = await this.bankTxRepo.findOne({ accountServiceRef: bankTx.accountServiceRef });
    if (entity)
      throw new ConflictException(`There is already a bank tx with the accountServiceRef: ${bankTx.accountServiceRef}`);

    entity = await this.bankTxRepo.create(bankTx);
    return await this.bankTxRepo.save(entity);
  }

  async storeSepaFiles(files: string[]): Promise<(BankTxBatch | Error)[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f).catch((e: Error) => e)));
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!bankTx) throw new NotFoundException('BankTx not found');
    // TODO später auskommentieren
    // if (bankTx.type && bankTx.type != BankTxType.UNKNOWN) throw new ConflictException('BankTx Type already set');

    bankTx.type = dto.type;

    if (bankTx.type === BankTxType.BUY_CRYPTO) await this.buyCryptoService.createFromFiat(bankTxId, dto.buyId);

    return await this.bankTxRepo.save(bankTx);
  }

  // --- HELPER METHODS --- //

  private async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // parse the file
    const batch = this.bankTxBatchRepo.create(SepaParser.parseBatch(sepaFile));
    const txList = this.bankTxRepo.create(SepaParser.parseEntries(sepaFile));

    // store the batch
    await this.bankTxBatchRepo.save(batch);

    // find duplicate entries
    const duplicates = await this.bankTxRepo
      .find({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      const message = `Duplicate SEPA entries found in batch ${batch.identification}:`;
      console.log(message, duplicates);
      this.mailService.sendErrorMail('SEPA Error', [message + ` ${duplicates.join(', ')}`]);
    }

    // store the entries
    const newTxs = txList
      .filter((i) => !duplicates.includes(i.accountServiceRef))
      .map((tx) => ({
        batch: batch,
        type: tx.name?.includes('DFX AG') || tx.name?.includes('Payward Ltd.') ? BankTxType.INTERNAL : null,
        ...tx,
      }));
    await this.bankTxRepo.saveMany(newTxs);

    batch.transactions = txList;
    return batch;
  }
}
