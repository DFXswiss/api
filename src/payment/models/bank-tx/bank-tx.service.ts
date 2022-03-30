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

  async getUnmapped(): Promise<BankTx[]> {
    const unmappedEntries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .leftJoin('bankTx.outReturnBankTx', 'outReturnBankTx')
      .where('bankTx.inReturnBankTx IS NULL')
      .andWhere('outReturnBankTx.id IS NULL')
      .andWhere('bankTx.nextRepeatBankTx IS NULL')
      .andWhere('previousRepeatBankTx.id IS NULL')
      .andWhere('cryptoSell.id IS NULL')
      .andWhere('cryptoBuy.id IS NULL')
      .andWhere("bankTx.name NOT LIKE '%DFX AG%' OR bankTx.name NOT LIKE '%Payward Ltd.%'")
      .getMany();

    return unmappedEntries;
  }

  async getEntriesWithMapping(): Promise<BankTx[]> {
    const entries = await this.bankTxRepo
      .createQueryBuilder('bankTx')
      .select('bankTx')
      .addSelect('cryptoSell.id')
      .addSelect('cryptoBuy.id')
      .addSelect('previousRepeatBankTx.id')
      .addSelect('outReturnBankTx.id')
      .leftJoin('bankTx.cryptoSell', 'cryptoSell')
      .leftJoin('bankTx.cryptoBuy', 'cryptoBuy')
      .leftJoin('bankTx.previousRepeatBankTx', 'previousRepeatBankTx')
      .leftJoin('bankTx.outReturnBankTx', 'outReturnBankTx')
      .where(
        new Brackets((b) => {
          b.where('cryptoSell.id IS NOT NULL')
            .orWhere('cryptoBuy.id IS NOT NULL')
            .orWhere("bankTx.name LIKE '%DFX AG%' OR bankTx.name LIKE '%Payward Ltd.%'")
            .orWhere('bankTx.inReturnBankTx IS NOT NULL')
            .orWhere('outReturnBankTx.id IS NOT NULL')
            .orWhere('bankTx.nextRepeatBankTx IS NOT NULL')
            .orWhere('previousRepeatBankTx.id IS NOT NULL');
        }),
      )
      .getMany();

    return entries;
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
