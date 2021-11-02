import { Injectable } from '@nestjs/common';
import * as XmlParser from 'fast-xml-parser';
import { FtpService } from 'src/shared/services/ftp.service';
import { Interval } from '@nestjs/schedule';
import { SepaFile } from './dto/sepa-file.dto';
import { FiatInputRepository } from './fiat-input.repository';
import { FiatInputBatchRepository } from './fiat-input-batch.repository';
import { FiatInputBatch } from './fiat-input-batch.entity';
import { FiatInput } from './fiat-input.entity';

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

  async fetchAndStoreSepaFiles() {
    const client = await FtpService.connect({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      directory: process.env.FTP_FOLDER,
    });

    // read file list
    const fileInfos = await client.listFiles();

    // store and move files to archive folder
    for (const fileInfo of fileInfos) {
      const file = await client.readFile(fileInfo);
      const batch = await this.storeSepaFile(file);
      await client.moveFile(fileInfo.name, 'archive', `${batch.identification}.xml`);
    }

    client.close();
  }

  async storeSepaFiles(files: string[]): Promise<FiatInputBatch[]> {
    return Promise.all(files.map((f) => this.storeSepaFile(f)));
  }

  // --- HELPER METHODS --- //
  private async storeSepaFile(xmlFile: string): Promise<FiatInputBatch> {
    const sepaFile = this.parseSepaFile(xmlFile);

    const batch = this.createBatch(sepaFile);
    const inputs = this.createInputs(sepaFile, batch);
    batch.fiatInputs = inputs;

    await this.fiatInputBatchRepo.save(batch);
    await this.fiatInputRepo.save(inputs);

    return batch;
  }

  private parseSepaFile(xmlFile: string): SepaFile {
    const validationResult = XmlParser.validate(xmlFile);
    if (validationResult !== true) {
      throw validationResult;
    }

    return XmlParser.parse(xmlFile, { ignoreAttributes: false }).Document;
  }

  private createBatch(file: SepaFile): FiatInputBatch {
    const info = file.BkToCstmrStmt.Stmt;

    return this.fiatInputBatchRepo.create({
      identification: info.Id,
      sequenceNumber: +info.ElctrncSeqNb,
      creationDate: new Date(info.CreDtTm),
      fromDate: new Date(info.FrToDt.FrDtTm),
      toDate: new Date(info.FrToDt.ToDtTm),
      duplicate: info.CpyDplctInd,
      iban: info.Acct.Id.IBAN,
      balanceBeforeAmount: +info.Bal[0].Amt['#text'],
      balanceBeforeCurrency: info.Bal[0].Amt['@Ccy'],
      balanceBeforeCdi: info.Bal[0].CdtDbtInd,
      balanceAfterAmount: +info.Bal[1].Amt['#text'],
      balanceAfterCurrency: info.Bal[1].Amt['@Ccy'],
      balanceAfterCdi: info.Bal[1].CdtDbtInd,
      totalCount: +info.TxsSummry.TtlNtries.NbOfNtries,
      totalAmount: +info.TxsSummry.TtlNtries.TtlNetNtry.Amt,
      totalCdi: info.TxsSummry.TtlNtries.TtlNetNtry.CdtDbtInd,
      creditCount: +info.TxsSummry.TtlCdtNtries.NbOfNtries,
      creditAmount: +info.TxsSummry.TtlCdtNtries.Sum,
      debitCount: +info.TxsSummry.TtlDbtNtries.NbOfNtries,
      debitAmount: +info.TxsSummry.TtlDbtNtries.Sum,
    });
  }

  private createInputs(file: SepaFile, batch: FiatInputBatch): FiatInput[] {
    throw new Error('Method not implemented.');
  }
}
