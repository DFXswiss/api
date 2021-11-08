import { Injectable } from '@nestjs/common';
import { FtpService } from 'src/shared/services/ftp.service';
import { Interval } from '@nestjs/schedule';
import { BankTxRepository } from './bank-tx.repository';
import { BankTxBatchRepository } from './bank-tx-batch.repository';
import { BankTxBatch } from './bank-tx-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';

@Injectable()
export class BankTxService {
  constructor(private readonly bankTxRepo: BankTxRepository, private readonly bankTxBatchRepo: BankTxBatchRepository) {}

  @Interval(3600000)
  async importSepaFiles(): Promise<void> {
    try {
      await this.fetchAndStoreSepaFiles();
    } catch (e) {
      console.error('Exception during SEPA import:', e);
    }
  }

  async storeSepaFiles(files: string[]): Promise<BankTxBatch[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f)));
  }

  // --- HELPER METHODS --- //
  private async fetchAndStoreSepaFiles(): Promise<void> {
    const client = await FtpService.connect({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      directory: process.env.FTP_FOLDER,
    });

    // read file list
    const fileInfos = await client.listFiles();
    if (fileInfos.length > 0) console.log('New SEPA files to import:', fileInfos);

    // store and move files to archive folder
    for (const fileInfo of fileInfos) {
      try {
        const file = await client.readFile(fileInfo);
        const batch = await this.storeSepaFile(file);
        await client.moveFile(fileInfo.name, 'archive', `${batch.identification}.xml`);
      } catch (e) {
        console.error(`Failed to import SEPA file ${fileInfo.name}:`, e);
      }
    }

    client.close();
  }

  private async storeSepaFile(xmlFile: string): Promise<BankTxBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // store the batch
    const batch = this.bankTxBatchRepo.create(SepaParser.parseBatch(sepaFile));
    await this.bankTxBatchRepo.save(batch);

    // store the entries (without duplicates)
    const txList = this.bankTxRepo.create(SepaParser.parseEntries(sepaFile, batch));
    const duplicates = await this.bankTxRepo
      .find({ accountServiceRef: In(txList.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      console.log(`Duplicate SEPA entries found:`, duplicates);
    }

    // store in batches
    const batchSize = 50;
    let remaining = txList.filter((i) => !duplicates.includes(i.accountServiceRef));
    do {
      const batch = remaining.slice(0, batchSize);
      remaining = remaining.slice(batchSize);

      await this.bankTxRepo.save(batch);
    } while (remaining.length > 0);

    batch.transactions = txList;
    return batch;
  }
}
