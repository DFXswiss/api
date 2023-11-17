import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { BankData } from '../../user/models/bank-data/bank-data.entity';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { UpdateNameCheckLogDto } from '../dto/update-name-check-log.dto';
import { NameCheckLog, RiskStatus } from '../entities/name-check-log.entity';
import { NameCheckLogRepository } from '../repositories/name-check-log.repository';
import { DilisenseService } from './integration/dilisense.service';

@Injectable()
export class NameCheckService implements OnModuleInit {
  // private readonly logger = new DfxLogger(NameCheckService);

  // private sanctionData: DilisenseJsonData[] = [];

  constructor(
    private readonly nameCheckLogRepo: NameCheckLogRepository,
    private readonly dilisenseService: DilisenseService,
    private readonly userDataService: UserDataService,
  ) {}

  onModuleInit() {
    // void this.reloadSanctionList();
  }

  async updateLog(id: number, dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    const entity = await this.nameCheckLogRepo.findOne({ where: { id }, relations: { userData: true } });
    if (!entity) throw new NotFoundException('NameCheckLog not found');

    const updatedEntity = await this.nameCheckLogRepo.save({ ...entity, ...dto, riskEvaluationDate: new Date() });

    !(await this.hasOpenNameChecks(entity.userData)) &&
      (await this.userDataService.refreshLastNameCheckDate(entity.userData));

    return updatedEntity;
  }

  async refreshRiskStatus(bankData: BankData): Promise<RiskStatus> {
    // const sanctionData = this.sanctionData.filter((data) =>
    //   this.isSanctionedData(data, userData.firstname.toLowerCase(), userData.surname.toLowerCase()),
    // );
    const sanctionData = await this.dilisenseService.getRiskData(bankData.name, bankData.userData.birthday);

    if (sanctionData.total_hits == 0) {
      await this.createNameCheckLog(bankData, JSON.stringify(sanctionData), RiskStatus.NOT_SANCTIONED);
      return RiskStatus.NOT_SANCTIONED;
    }

    for (const sanction of sanctionData.found_records) {
      await this.createNameCheckLog(bankData, JSON.stringify(sanction), RiskStatus.SANCTIONED);
    }

    return RiskStatus.SANCTIONED;
  }

  // --- HELPER METHODS --- //

  private async createNameCheckLog(bankData: BankData, result: string, riskRate: RiskStatus): Promise<void> {
    const existing = await this.nameCheckLogRepo.findOne({
      where: { userData: { id: bankData.userData.id }, result },
      relations: { userData: true, bankData: true },
    });

    const entity = this.nameCheckLogRepo.create({
      type: 'NameCheck',
      result,
      riskStatus: riskRate,
      userData: bankData.userData,
      bankData,
      riskEvaluationDate: existing?.riskEvaluationDate,
      riskEvaluation: existing?.riskEvaluation,
      comment: existing?.comment,
    });

    await this.nameCheckLogRepo.save(entity);

    !(await this.hasOpenNameChecks(entity.userData)) &&
      (await this.userDataService.refreshLastNameCheckDate(bankData.userData));
  }

  private async hasOpenNameChecks(userData: UserData): Promise<boolean> {
    return this.nameCheckLogRepo.exist({
      where: { userData: { id: userData.id }, riskEvaluation: IsNull(), riskStatus: RiskStatus.SANCTIONED },
      relations: { userData: true },
    });
  }

  // TODO Dilisense JSON solution

  // private isSanctionedData(data: DilisenseJsonData, firstname: string, surname: string): boolean {
  //   return (
  //     //data.lastNames?.map((name) => name).includes(surname) &&
  //     (data.name?.includes(firstname) && data.name?.includes(surname)) ||
  //     (data.givenNames?.includes(firstname) && data.givenNames?.includes(surname)) ||
  //     (data.aliasNames?.includes(firstname) && data.aliasNames?.includes(surname))
  //   );
  // }

  // private async reloadSanctionList(): Promise<void> {
  //   this.sanctionData = [];

  //   const file = await Util.readFileFromDisk(Config.dilisense.jsonPath);
  //   for (const line of file.split('\n')) {
  //     try {
  //       const data: DilisenseJsonData = JSON.parse(line);
  //       this.sanctionData.push(this.mapSanctionDataLowerCase(data));
  //     } catch (e) {
  //       this.logger.critical(`Error reading sanction data line ${line}:`, e);
  //     }
  //   }
  // }

  // private mapSanctionDataLowerCase(data: DilisenseJsonData): DilisenseJsonData {
  //   return {
  //     ...data,
  //     name: data.name.toLowerCase(),
  //     lastNames: data.lastNames?.map((name) => name.toLowerCase()),
  //     givenNames: data.givenNames?.map((name) => name.toLowerCase()),
  //     aliasNames: data.aliasNames?.map((name) => name.toLowerCase()),
  //   };
  // }
}
