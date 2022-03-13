import { Injectable } from '@nestjs/common';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';
import { MailService } from 'src/shared/services/mail.service';

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
    await this.bankTxRepo.save(newTxs);

    batch.transactions = txList;
    return batch;
  }
}
