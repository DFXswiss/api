import { Injectable } from '@nestjs/common';
import fs from 'fs';
import readline from 'readline';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { DilisenseData } from '../dto/dilisense-data.dto';
import { RiskRate } from '../entities/kyc-log.entity';
import { KycLogService } from './kyc-log.service';

@Injectable()
export class NameCheckService {
  private readonly logger = new DfxLogger(NameCheckService);

  private readonly sanctionListPath = 'src/subdomains/generic/kyc/data/dilisense_consolidated_data_file.jsonl';
  private sanctionData: DilisenseData[] = [];

  constructor(private kycLogService: KycLogService) {
    this.reloadSanctionList();
  }

  async doNameCheck(userData: UserData, firstname: string, surname: string): Promise<RiskRate> {
    const sanctionData = this.sanctionData.filter((data) =>
      this.isSanctioned(data, firstname.toLowerCase(), surname.toLowerCase()),
    );
    if (sanctionData.length == 0) {
      await this.createKycLog(userData, null, RiskRate.NOT_SANCTIONED);
      return RiskRate.NOT_SANCTIONED;
    }

    for (const sanction of sanctionData) {
      if (this.kycLogService.alreadyExistingLogs(userData, JSON.stringify(sanction))) continue;
      await this.createKycLog(userData, JSON.stringify(sanction), RiskRate.SANCTIONED);
    }

    return RiskRate.SANCTIONED;
  }

  // --- HELPER METHODS --- //

  private async createKycLog(userData: UserData, result: string, riskRate: RiskRate): Promise<void> {
    await this.kycLogService.create({
      eventType: 'NameCheck',
      pdfUrl: '',
      result,
      riskRate,
      userData: userData,
    });
  }

  private isSanctioned(data: DilisenseData, firstname: string, surname: string): boolean {
    return (
      //data.lastNames?.map((name) => name).includes(surname) &&
      (data.name?.includes(firstname) && data.name?.includes(surname)) ||
      (data.givenNames?.includes(firstname) && data.givenNames?.includes(surname)) ||
      (data.aliasNames?.includes(firstname) && data.aliasNames?.includes(surname))
    );
  }

  private async reloadSanctionList(): Promise<void> {
    this.sanctionData = [];

    const dataInput = readline.createInterface({
      input: fs.createReadStream(this.sanctionListPath),
      output: process.stdout,
      terminal: false,
    });

    for await (const line of dataInput) {
      try {
        const data: DilisenseData = JSON.parse(line);
        this.sanctionData.push(this.mapSanctionDataLowerCase(data));
      } catch (error) {
        this.logger.critical(`Error reading sanction data line ${line}:`, error);
      }
    }
  }

  private mapSanctionDataLowerCase(data: DilisenseData): DilisenseData {
    return {
      ...data,
      name: data.name.toLowerCase(),
      lastNames: data.lastNames?.map((name) => name.toLowerCase()),
      givenNames: data.givenNames?.map((name) => name.toLowerCase()),
      aliasNames: data.aliasNames?.map((name) => name.toLowerCase()),
    };
  }
}
