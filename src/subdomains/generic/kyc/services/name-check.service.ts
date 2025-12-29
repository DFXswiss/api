import { Injectable, InternalServerErrorException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { IsNull } from 'typeorm';
import { BankData, BankDataType } from '../../user/models/bank-data/bank-data.entity';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { DilisenseApiData } from '../dto/input/dilisense-data.dto';
import { UpdateNameCheckLogDto } from '../dto/input/update-name-check-log.dto';
import { FileSubType, FileType } from '../dto/kyc-file.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { NameCheckLog, NameCheckRiskStatus, RiskEvaluation } from '../entities/name-check-log.entity';
import { ContentType } from '../enums/content-type.enum';
import { NameCheckLogRepository } from '../repositories/name-check-log.repository';
import { DilisenseService } from './integration/dilisense.service';
import { KycDocumentService } from './integration/kyc-document.service';

@Injectable()
export class NameCheckService implements OnModuleInit {
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

    if (!(await this.hasOpenNameChecks(entity.userData)))
      await this.userDataService.refreshLastNameCheckDate(entity.userData);

    return updatedEntity;
  }

  async refreshRiskStatus(bankData: BankData): Promise<NameCheckRiskStatus> {
    // const sanctionData = this.sanctionData.filter((data) =>
    //   this.isSanctionedData(data, userData.firstname.toLowerCase(), userData.surname.toLowerCase()),
    // );

    // Personal name check
    if (!bankData.userData.accountType || bankData.userData.accountType === AccountType.PERSONAL) {
      const { data, file } = await this.getRiskDataAndUploadPdf(
        bankData.userData,
        false,
        bankData.type === BankDataType.CARD_IN && bankData.userData.verifiedName
          ? bankData.userData.verifiedName
          : bankData.name,
        bankData.userData.birthday,
      );

      return this.classifyRiskData(data, file, bankData);
    }

    // Business name check
    const { data: personalSanctionData, file: personalSanctionFile } = await this.getRiskDataAndUploadPdf(
      bankData.userData,
      false,
      `${bankData.userData.firstname} ${bankData.userData.surname}`,
      bankData.userData.birthday,
    );

    const { data: businessSanctionData, file: businessSanctionFile } = await this.getRiskDataAndUploadPdf(
      bankData.userData,
      true,
      bankData.userData.organizationName,
    );

    const riskStatus = [
      await this.classifyRiskData(personalSanctionData, personalSanctionFile, bankData),
      await this.classifyRiskData(businessSanctionData, businessSanctionFile, bankData, 'Business'),
    ];

    if (
      riskStatus.some((r) => r === NameCheckRiskStatus.SANCTIONED) ||
      riskStatus[1] === NameCheckRiskStatus.MATCH_WITHOUT_BIRTHDAY
    )
      return NameCheckRiskStatus.SANCTIONED;
    if (riskStatus[0] === NameCheckRiskStatus.MATCH_WITHOUT_BIRTHDAY) return NameCheckRiskStatus.MATCH_WITHOUT_BIRTHDAY;
    return NameCheckRiskStatus.NOT_SANCTIONED;
  }

  private async classifyRiskData(
    sanctionData: DilisenseApiData,
    file: KycFile,
    bankData: BankData,
    comment = '',
  ): Promise<NameCheckRiskStatus> {
    if (sanctionData.total_hits == 0) {
      await this.createNameCheckLog(
        bankData,
        JSON.stringify(sanctionData),
        NameCheckRiskStatus.NOT_SANCTIONED,
        file,
        comment,
      );
      return NameCheckRiskStatus.NOT_SANCTIONED;
    }

    if (sanctionData.found_records.every((s) => !s.date_of_birth?.length)) {
      await this.createNameCheckLog(
        bankData,
        JSON.stringify(sanctionData),
        NameCheckRiskStatus.MATCH_WITHOUT_BIRTHDAY,
        file,
        comment,
      );
      return NameCheckRiskStatus.MATCH_WITHOUT_BIRTHDAY;
    }

    for (const sanction of sanctionData.found_records) {
      await this.createNameCheckLog(
        bankData,
        JSON.stringify(sanction),
        !sanction.date_of_birth?.length ? NameCheckRiskStatus.MATCH_WITHOUT_BIRTHDAY : NameCheckRiskStatus.SANCTIONED,
        file,
        comment,
      );
    }

    return NameCheckRiskStatus.SANCTIONED;
  }

  private async getRiskDataAndUploadPdf(
    userData: UserData,
    isBusiness: boolean,
    name: string,
    dob?: Date,
    onlyPdf = false,
  ): Promise<{ data: DilisenseApiData; file: KycFile }> {
    if (!name) throw new InternalServerErrorException(`NameCheck name is missing, userData ${userData.id}`);
    const { data: riskData, pdfData } = await this.dilisenseService.getRiskData(name, isBusiness, dob, onlyPdf);

    // upload file
    const { contentType, buffer } = Util.fromBase64(`application/pdf;base64,${pdfData}`);
    const { file } = await this.documentService.uploadFile(
      userData,
      FileType.NAME_CHECK,
      `${Util.isoDate(new Date()).replace(/-/g, '')}-NameCheck-${userData.id}-${name.replace(/ /g, '-')}-${Util.isoTime(
        new Date(),
      ).replace(/-/g, '')}.pdf`,
      buffer,
      contentType as ContentType,
      true,
      true,
      undefined,
      isBusiness ? FileSubType.BUSINESS_NAME_CHECK : FileSubType.PERSONAL_NAME_CHECK,
    );

    return { data: riskData, file };
  }

  async closeAndRefreshRiskStatus(bankData: BankData): Promise<void> {
    const openNameChecks = await this.nameCheckLogRepo.find({
      where: {
        userData: { id: bankData.userData.id },
        riskEvaluation: IsNull(),
        riskStatus: NameCheckRiskStatus.SANCTIONED,
      },
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
      where: { userData: { id: userData.id }, riskEvaluation: IsNull(), riskStatus: NameCheckRiskStatus.SANCTIONED },
      relations: { userData: true },
    });
  }

  // --- HELPER METHODS --- //

  private async createNameCheckLog(
    bankData: BankData,
    result: string,
    riskRate: NameCheckRiskStatus,
    file: KycFile,
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
      file,
    });

    await this.nameCheckLogRepo.save(entity);

    if (!(await this.hasOpenNameChecks(entity.userData)))
      await this.userDataService.refreshLastNameCheckDate(bankData.userData);
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
