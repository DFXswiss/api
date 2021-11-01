import { Injectable } from '@nestjs/common';
import { FiatInput } from './fiat-input.entity';
import * as XmlParser from 'fast-xml-parser';
import { FtpService } from 'src/shared/services/ftp.service';
import { Interval } from '@nestjs/schedule';

interface SepaFile {
  BkToCstmrStmt: {
    Stmt: {
      Id: string; // unique
      ElctrncSeqNb: string;
      CreDtTm: string;Ë
      FrToDt: {
        FrDtTm: string;
        ToDtTm: string;
      };
    };
  };
}

@Injectable()
export class FiatInputService {
  @Interval(3600000)
  async importSepaFiles(): Promise<void> {
    try {
      await this.fetchAndStoreSepaFiles();
    } catch (e) {
      console.error('Exception during SEPA import:', e);
    }
  }

  async storeSepaFiles(files: string[]): Promise<FiatInput[]> {
    const inputs = files.map((f) => this.parseSepaXml(f)).reduce((prev, curr) => prev.concat(curr), []);
    // TODO: batch

    return inputs;
  }

  async fetchAndStoreSepaFiles() {
    const client = await FtpService.connect({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      directory: 'bank',
    });

    // read file list
    const fileInfos = await client.listFiles();

    for (const fileInfo of fileInfos) {
      // read and parse
      const file = await client.readFile(fileInfo);
      const sepaFile = this.parseSepaXml(file);

      // TODO: store to DB

      // rename and move to archive folder
      await client.moveFile(fileInfo.name, 'archive', `${sepaFile.BkToCstmrStmt.Stmt.Id}.xml`);
    }

    client.close();
  }

  // --- HELPER METHODS --- //
  private parseSepaXml(xmlFile: string): SepaFile {
    const validationResult = XmlParser.validate(xmlFile);
    if (validationResult !== true) {
      throw validationResult;
    }

    return XmlParser.parse(xmlFile, { ignoreAttributes: false }).Document;
  }
}
