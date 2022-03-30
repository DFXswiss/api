import { Injectable, NotFoundException } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { Brackets, In } from 'typeorm';
import { MailService } from 'src/shared/services/mail.service';
import { UpdateBankTxDto } from './dto/update-bank-tx.dto';
import { BankTx, BankTxType } from './bank-tx.entity';

@Injectable()
export class BankTxService {
  constructor(
    private readonly bankTxRepo: BankTxRepository,
    private readonly bankTxBatchRepo: BankTxBatchRepository,
    private readonly mailService: MailService,
  ) {}

  async storeSepaFiles(files: string[]): Promise<(BankTxBatch | Error)[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f).catch((e: Error) => e)));
  }

  async update(bankTxId: number, dto: UpdateBankTxDto): Promise<BankTx> {
    const bankTx = await this.bankTxRepo.findOne(bankTxId);
    if (!bankTx) throw new NotFoundException('BankTx not found');

    return await this.bankTxRepo.save({ ...bankTx, ...dto });
  }

  async updateTxTypes(): Promise<void> {
    const unmappedEntries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .leftJoinAndSelect('bankTx.cryptoSell', 'cryptoSell')
      .leftJoinAndSelect('bankTx.cryptoBuy', 'cryptoBuy')
      .where('bankTx.txType IS NULL')
      .andWhere(
        new Brackets((b) => {
          b.where('cryptoSell.id IS NOT NULL')
            .orWhere('cryptoBuy.id IS NOT NULL')
            .orWhere("bankTx.name LIKE '%DFX AG%' OR bankTx.name LIKE '%Payward Ltd.%'");
        }),
      )
      .getMany();

    await this.setType(
      unmappedEntries.filter((e) => e.cryptoBuy),
      BankTxType.CRYPTO_BUY,
    );
    await this.setType(
      unmappedEntries.filter((e) => e.cryptoSell),
      BankTxType.CRYPTO_SELL,
    );
    await this.setType(
      unmappedEntries.filter((e) => !e.cryptoBuy && !e.cryptoSell),
      BankTxType.INTERNAL,
    );
  }

  private async setType(bankTx: BankTx[], txType: BankTxType): Promise<void> {
    if (bankTx.length > 0) {
      await this.bankTxRepo.update(
        bankTx.map((e) => e.id),
        { txType },
      );
    }
  }

  async getProblems(): Promise<BankTx[]> {
    return await this.bankTxRepo.find({ where: { txType: null } });
  }

  async get(txType: BankTxType): Promise<BankTx[]> {
    return await this.bankTxRepo.find({ where: { txType } });
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
      .map((tx) => ({ batch: batch, ...tx }));
    await this.bankTxRepo.saveMany(newTxs);

    batch.transactions = txList;
    return batch;
  }
}
