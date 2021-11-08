import { Injectable } from '@nestjs/common';
import { FtpService } from 'src/shared/services/ftp.service';
import { Interval } from '@nestjs/schedule';
import { FiatInputRepository } from './fiat-input.repository';
import { FiatInputBatchRepository } from './fiat-input-batch.repository';
import { FiatInputBatch } from './fiat-input-batch.entity';
import { SepaParser } from './sepa-parser.service';
import { In } from 'typeorm';

@Injectable()
export class FiatInputService {
  constructor(
    private readonly fiatInputRepo: FiatInputRepository,
    private readonly fiatInputBatchRepo: FiatInputBatchRepository,
  ) {}

  @Interval(3600000)
  async importSepaFiles(): Promise<void> {
    try {
      await this.fetchAndStoreSepaFiles();
    } catch (e) {
      console.error('Exception during SEPA import:', e);
    }
  }

  async storeSepaFiles(files: string[]): Promise<FiatInputBatch[]> {
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

  private async storeSepaFile(xmlFile: string): Promise<FiatInputBatch> {
    const sepaFile = SepaParser.parseSepaFile(xmlFile);

    // store the batch
    const batch = this.fiatInputBatchRepo.create(SepaParser.parseBatch(sepaFile));
    await this.fiatInputBatchRepo.save(batch);

    // store the entries (without duplicates)
    const inputs = this.fiatInputRepo.create(SepaParser.parseEntries(sepaFile, batch));
    const duplicates = await this.fiatInputRepo
      .find({ accountServiceRef: In(inputs.map((i) => i.accountServiceRef)) })
      .then((list) => list.map((i) => i.accountServiceRef));
    if (duplicates.length > 0) {
      console.log(`Duplicate SEPA entries found:`, duplicates);
    }
    await this.fiatInputRepo.save(inputs.filter((i) => !duplicates.includes(i.accountServiceRef)));

    batch.fiatInputs = inputs;
    return batch;
  }
}
