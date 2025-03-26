import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { IsNull } from 'typeorm';
import { BankData, BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { DilisenseApiData } from '../dto/input/dilisense-data.dto';
import { UpdateNameCheckLogDto } from '../dto/input/update-name-check-log.dto';
import { FileType } from '../dto/kyc-file.dto';
import { NameCheckLog, RiskEvaluation, RiskStatus } from '../entities/name-check-log.entity';
import { ContentType } from '../enums/content-type.enum';
import { NameCheckLogRepository } from '../repositories/name-check-log.repository';
import { DilisenseService } from './integration/dilisense.service';
import { KycDocumentService } from './integration/kyc-document.service';

@Injectable()
export class NameCheckService implements OnModuleInit {
  // private readonly logger = new DfxLogger(NameCheckService);

  // private sanctionData: DilisenseJsonData[] = [];

  constructor(
    private readonly nameCheckLogRepo: NameCheckLogRepository,
    private readonly dilisenseService: DilisenseService,
    private readonly userDataService: UserDataService,
    private readonly documentService: KycDocumentService,
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

    // Personal name check
    if (bankData.userData.accountType !== AccountType.ORGANIZATION) {
      const sanctionData = await this.getRiskDataAndUploadPdf(
        bankData.userData,
        bankData.type === BankDataType.CARD_IN && bankData.userData.verifiedName
          ? bankData.userData.verifiedName
          : bankData.name,
        bankData.userData.birthday,
      );

      return this.classifyRiskData(sanctionData, bankData);
    }

    // Business name check
    const personalSanctionData = await this.getRiskDataAndUploadPdf(
      bankData.userData,
      `${bankData.userData.firstname} ${bankData.userData.surname}`,
      bankData.userData.birthday,
    );

    const businessSanctionData = await this.getRiskDataAndUploadPdf(
      bankData.userData,
      bankData.userData.organizationName,
    );

    const riskStatus = [
      await this.classifyRiskData(personalSanctionData, bankData),
      await this.classifyRiskData(businessSanctionData, bankData, 'Business'),
    ];

    if (riskStatus.some((r) => r === RiskStatus.SANCTIONED) || riskStatus[1] === RiskStatus.MATCH_WITHOUT_BIRTHDAY)
      return RiskStatus.SANCTIONED;
    if (riskStatus[0] === RiskStatus.MATCH_WITHOUT_BIRTHDAY) return RiskStatus.MATCH_WITHOUT_BIRTHDAY;
    return RiskStatus.NOT_SANCTIONED;
  }

  private async classifyRiskData(
    sanctionData: DilisenseApiData,
    bankData: BankData,
    comment = '',
  ): Promise<RiskStatus> {
    if (sanctionData.total_hits == 0) {
      await this.createNameCheckLog(bankData, JSON.stringify(sanctionData), RiskStatus.NOT_SANCTIONED, comment);
      return RiskStatus.NOT_SANCTIONED;
    }

    if (sanctionData.found_records.every((s) => !s.date_of_birth?.length)) {
      await this.createNameCheckLog(bankData, JSON.stringify(sanctionData), RiskStatus.MATCH_WITHOUT_BIRTHDAY, comment);
      return RiskStatus.MATCH_WITHOUT_BIRTHDAY;
    }

    for (const sanction of sanctionData.found_records) {
      await this.createNameCheckLog(
        bankData,
        JSON.stringify(sanction),
        !sanction.date_of_birth?.length ? RiskStatus.MATCH_WITHOUT_BIRTHDAY : RiskStatus.SANCTIONED,
        comment,
      );
    }

    return RiskStatus.SANCTIONED;
  }

  async getRiskDataAndUploadPdf(userData: UserData, name: string, dob?: Date): Promise<DilisenseApiData> {
    const { data: riskData, pdfData } = await this.dilisenseService.getRiskData(name, dob);

    // upload file
    const { contentType, buffer } = Util.fromBase64(pdfData);
    await this.documentService.uploadFile(
      userData,
      FileType.NAME_CHECK,
      `nameCheck-${Date.now().toLocaleString()}`,
      buffer,
      contentType as ContentType,
      false, // TODO protected data or not?
    );

    return riskData;
  }

  async closeAndRefreshRiskStatus(bankData: BankData): Promise<void> {
    const openNameChecks = await this.nameCheckLogRepo.find({
      where: { userData: { id: bankData.userData.id }, riskEvaluation: IsNull(), riskStatus: RiskStatus.SANCTIONED },
      relations: { userData: true },
    });

    for (const nameCheck of openNameChecks) {
      await this.nameCheckLogRepo.update(nameCheck.id, {
        riskEvaluation: RiskEvaluation.CANCELED,
        riskEvaluationDate: new Date(),
        comment: `${bankData.type} refresh`,
      });
    }

    await this.refreshRiskStatus(bankData);
  }

  async hasOpenNameChecks(userData: UserData): Promise<boolean> {
    return this.nameCheckLogRepo.exists({
      where: { userData: { id: userData.id }, riskEvaluation: IsNull(), riskStatus: RiskStatus.SANCTIONED },
      relations: { userData: true },
    });
  }

  // --- HELPER METHODS --- //

  private async createNameCheckLog(
    bankData: BankData,
    result: string,
    riskRate: RiskStatus,
    comment?: string,
  ): Promise<void> {
    const existing = await this.nameCheckLogRepo.findOne({
      where: { userData: { id: bankData.userData.id }, result },
      relations: { userData: true, bankData: true },
    });

    const entity = this.nameCheckLogRepo.create({
      result,
      riskStatus: riskRate,
      userData: bankData.userData,
      bankData,
      riskEvaluationDate: existing?.riskEvaluationDate,
      riskEvaluation: existing?.riskEvaluation,
      comment: existing?.comment ? [existing.comment, comment].join(';') : comment,
    });

    await this.nameCheckLogRepo.save(entity);

    !(await this.hasOpenNameChecks(entity.userData)) &&
      (await this.userDataService.refreshLastNameCheckDate(bankData.userData));
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
