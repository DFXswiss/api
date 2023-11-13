import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import fs from 'fs';
import readline from 'readline';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { CreateNameCheckLogDto } from '../dto/create-name-check-log.dto';
import { DilisenseData } from '../dto/dilisense-data.dto';
import { UpdateNameCheckLogDto } from '../dto/update-name-check-log.dto';
import { RiskRate } from '../entities/kyc-log.entity';
import { ManualRiskRate, NameCheckLog } from '../entities/name-check-log.entity';
import { NameCheckLogRepository } from '../repositories/name-check-log.repository';

@Injectable()
export class NameCheckLogService implements OnModuleInit {
  private readonly logger = new DfxLogger(NameCheckLogService);

  private readonly sanctionListPath = 'src/subdomains/generic/kyc/data/dilisense_consolidated_data_file.jsonl';
  private sanctionData: DilisenseData[] = [];

  constructor(private readonly nameCheckLogRepo: NameCheckLogRepository) {}

  onModuleInit() {
    void this.reloadSanctionList();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async sendNotificationMails(): Promise<void> {
    await this.refreshNameCheck(null, 'PEDROs Ricardo', 'Alves');
  }

  async create(dto: CreateNameCheckLogDto): Promise<NameCheckLog> {
    const entity = this.nameCheckLogRepo.create(dto);

    return this.nameCheckLogRepo.save(entity);
  }

  async update(id: number, dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    const entity = await this.nameCheckLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('NameCheckLog not found');

    return this.nameCheckLogRepo.save({ ...entity, ...dto, manualRateTimestamp: new Date() });
  }

  async doNameCheck(userData: UserData): Promise<RiskRate> {
    const entities = await this.nameCheckLogRepo.find({
      where: { userData: { id: userData.id } },
      relations: { userData: true },
    });
    if (entities.length == 0) return RiskRate.NOT_SANCTIONED;

    const riskEntities = entities.filter(
      (risk) =>
        risk.riskRate === RiskRate.SANCTIONED &&
        (!risk.manualRiskRate || risk.manualRiskRate === ManualRiskRate.RISK_CONFIRMED),
    );

    if (riskEntities.length != 0) return RiskRate.SANCTIONED;

    return RiskRate.NOT_SANCTIONED;
  }

  async refreshNameCheck(userData: UserData, firstname: string, surname: string): Promise<RiskRate> {
    const sanctionData = this.sanctionData.filter((data) =>
      this.isSanctioned(data, firstname.toLowerCase(), surname.toLowerCase()),
    );
    if (sanctionData.length == 0) {
      await this.createNameCheckLog(userData, null, RiskRate.NOT_SANCTIONED);
      return RiskRate.NOT_SANCTIONED;
    }

    for (const sanction of sanctionData) {
      if (this.logExists(userData, JSON.stringify(sanction))) continue;
      await this.createNameCheckLog(userData, JSON.stringify(sanction), RiskRate.SANCTIONED);
    }

    return RiskRate.SANCTIONED;
  }

  // --- HELPER METHODS --- //

  private async logExists(userData: UserData, result: string): Promise<boolean> {
    const entities = await this.nameCheckLogRepo.find({
      where: { userData: { id: userData.id }, result },
      relations: { userData: true },
    });
    return entities.length > 0;
  }

  private async createNameCheckLog(userData: UserData, result: string, riskRate: RiskRate): Promise<void> {
    // TODO create pdf and upload to GDrive

    await this.create({
      eventType: 'NameCheck',
      pdfUrl: undefined,
      result,
      riskRate,
      userData,
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
