import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { CreateNameCheckLogDto } from '../dto/create-name-check-log.dto';
import { UpdateNameCheckLogDto } from '../dto/update-name-check-log.dto';
import { ManualRiskRate, NameCheckLog, RiskStatus } from '../entities/name-check-log.entity';
import { NameCheckLogRepository } from '../repositories/name-check-log.repository';
import { DilisenseService } from './dilisense.service';

@Injectable()
export class NameCheckService implements OnModuleInit {
  // private readonly logger = new DfxLogger(NameCheckService);

  // private sanctionData: DilisenseJsonData[] = [];

  constructor(
    private readonly nameCheckLogRepo: NameCheckLogRepository,
    private readonly dilisenseService: DilisenseService,
  ) {}

  onModuleInit() {
    // void this.reloadSanctionList();
  }

  async create(dto: CreateNameCheckLogDto): Promise<NameCheckLog> {
    const entity = this.nameCheckLogRepo.create(dto);

    return this.nameCheckLogRepo.save(entity);
  }

  async updateLog(id: number, dto: UpdateNameCheckLogDto): Promise<NameCheckLog> {
    const entity = await this.nameCheckLogRepo.findOneBy({ id });
    if (!entity) throw new NotFoundException('NameCheckLog not found');

    return this.nameCheckLogRepo.save({ ...entity, ...dto, manualRateTimestamp: new Date() });
  }

  async getRiskStatus(userData: UserData): Promise<RiskStatus> {
    const entities = await this.nameCheckLogRepo.find({
      where: { userData: { id: userData.id } },
      relations: { userData: true },
    });
    if (entities.length == 0) return this.refreshRiskStatus(userData);

    return entities.some(
      (risk) =>
        risk.riskRate === RiskStatus.SANCTIONED &&
        (!risk.manualRiskRate || risk.manualRiskRate === ManualRiskRate.CONFIRMED),
    )
      ? RiskStatus.SANCTIONED
      : RiskStatus.NOT_SANCTIONED;
  }

  async refreshRiskStatus(userData: UserData): Promise<RiskStatus> {
    // const sanctionData = this.sanctionData.filter((data) =>
    //   this.isSanctionedData(data, userData.firstname.toLowerCase(), userData.surname.toLowerCase()),
    // );
    const sanctionData = await this.dilisenseService.getRiskData(
      `${userData.firstname} ${userData.surname}`,
      userData.birthday,
    );

    if (sanctionData.total_hits == 0) {
      await this.createNameCheckLog(userData, JSON.stringify(sanctionData), RiskStatus.NOT_SANCTIONED);
      return RiskStatus.NOT_SANCTIONED;
    }

    for (const sanction of sanctionData.found_records) {
      if (this.logExists(userData, JSON.stringify(sanction))) continue;
      await this.createNameCheckLog(userData, JSON.stringify(sanction), RiskStatus.SANCTIONED);
    }

    return RiskStatus.SANCTIONED;
  }

  // --- HELPER METHODS --- //

  private async logExists(userData: UserData, result: string): Promise<boolean> {
    const entities = await this.nameCheckLogRepo.find({
      where: { userData: { id: userData.id }, result },
      relations: { userData: true },
    });
    return entities.length > 0;
  }

  private async createNameCheckLog(userData: UserData, result: string, riskRate: RiskStatus): Promise<void> {
    const entity = this.nameCheckLogRepo.create({
      type: 'NameCheck',
      result,
      riskRate,
      userData,
    });

    await this.nameCheckLogRepo.save(entity);
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
