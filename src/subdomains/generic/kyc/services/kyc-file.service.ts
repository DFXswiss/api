import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { FindOptionsRelations, In, IsNull } from 'typeorm';
import { CreateKycFileDto, FileSubType, FileType } from '../dto/kyc-file.dto';
import { IdDocType, SumsubResult } from '../dto/sum-sub.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { KycFileRepository } from '../repositories/kyc-file.repository';
import { SumsubService } from './integration/sum-sub.service';

@Injectable()
export class KycFileService {
  constructor(private readonly kycFileRepository: KycFileRepository, private readonly sumSubService: SumsubService) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.SYNC_FILE_SUB_TYPE, timeout: 7200 })
  async syncFileSubType() {
    const entities = await this.kycFileRepository.find({
      where: { type: In([FileType.USER_NOTES, FileType.NAME_CHECK, FileType.IDENTIFICATION]), subType: IsNull() },
      take: 15000,
      relations: { logs: true },
    });

    for (const entity of entities) {
      if (entity.name.includes('AddressSignature-')) entity.subType = FileSubType.ADDRESS_SIGNATURE;
      if (entity.name.includes('NameCheck-'))
        entity.subType =
          entity.type === FileType.USER_NOTES
            ? FileSubType.DFX_NAME_CHECK
            : entity.logs[0]?.comment === 'Business'
            ? FileSubType.BUSINESS_NAME_CHECK
            : FileSubType.PERSONAL_NAME_CHECK;
      if (entity.name.includes('limit-request_user-upload')) entity.subType = FileSubType.LIMIT_REQUEST_USER_UPLOAD;
      if (entity.name.includes('-TxAudit')) entity.subType = FileSubType.TX_AUDIT;
      if (entity.name.includes('LimitRequest-')) entity.subType = FileSubType.LIMIT_REQUEST_REPORT;
      if (entity.name.includes('postversand-')) entity.subType = FileSubType.POST_DISPATCH;
      if (entity.name.includes('onboarding-')) entity.subType = FileSubType.ONBOARDING_REPORT;
      if (entity.name.includes('Risikoprofil-')) entity.subType = FileSubType.RISK_PROFILE;
      if (entity.name.includes('Identifizierungsformular-')) entity.subType = FileSubType.IDENTIFICATION_FORM;
      if (entity.name.includes('Kundenprofil-')) entity.subType = FileSubType.CUSTOMER_PROFILE;
      if (entity.name.includes('FormularA-')) entity.subType = FileSubType.FORM_A;
      if (entity.name.includes('FormularK-')) entity.subType = FileSubType.FORM_K;
      if (entity.name.includes('bankTransactionVerify-')) entity.subType = FileSubType.BANK_TRANSACTION_VERIFICATION;
      if (entity.name.includes('blockchainAddressAnalyse-')) entity.subType = FileSubType.BLOCKCHAIN_ADDRESS_ANALYSIS;
      if (entity.name.includes('GwGFileDeckblatt-')) entity.subType = FileSubType.GWG_FILE_COVER;
      if (entity.name.includes('GenerelleAktennotiz-')) entity.subType = FileSubType.GENERAL_NOTE;
      if (entity.name.includes('Vollmacht-')) entity.subType = FileSubType.AUTHORITY_REPORT;
      if (entity.name.includes('HRAuszug-')) entity.subType = FileSubType.COMMERCIAL_REGISTER_REPORT;
      if (entity.type === FileType.IDENTIFICATION) {
        if (
          entity.name.includes('manualonboarding') ||
          entity.name.includes('-auto-') ||
          entity.name.includes('.zip') ||
          entity.name.includes('.pdf') ||
          entity.name.includes('manual-ident_')
        )
          entity.subType = FileSubType.IDENT_REPORT;

        if (entity.name.includes('.mp3') || entity.name.includes('.mp4')) entity.subType = FileSubType.IDENT_RECORDING;

        if (entity.name.includes('.png')) {
          const { webhook } = entity.kycStep.getResult<SumsubResult>();
          const applicantMetaData = await this.sumSubService.getApplicantMetadata(webhook.applicantId);
          const imageId = entity.name.split('-').pop()?.replace('.png', '');
          for (const image of applicantMetaData.items) {
            const identDocTypes = [
              IdDocType.ID_CARD,
              IdDocType.PASSPORT,
              IdDocType.DRIVERS,
              IdDocType.DRIVERS_TRANSLATION,
              IdDocType.ID_DOC_PHOTO,
            ];
            if (image.id === imageId) {
              entity.subType = identDocTypes.includes(image.idDocDef.idDocType)
                ? FileSubType.IDENT_DOC
                : FileSubType.IDENT_SELFIE;
            }
          }
        }
      }

      if (entity.subType) await this.kycFileRepository.update(entity.id, { subType: entity.subType });
    }
  }

  async createKycFile(dto: CreateKycFileDto): Promise<KycFile> {
    const entity = this.kycFileRepository.create(dto);

    entity.uid = `F${Util.randomString(16)}`;

    return this.kycFileRepository.save(entity);
  }

  async getKycFile(uid: string, relations?: FindOptionsRelations<KycFile>): Promise<KycFile> {
    return this.kycFileRepository.findOne({
      where: { uid },
      relations,
    });
  }
}
