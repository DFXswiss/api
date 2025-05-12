import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { FindOptionsRelations, In, IsNull } from 'typeorm';
import { CreateKycFileDto, FileSubType, FileType } from '../dto/kyc-file.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { KycFileRepository } from '../repositories/kyc-file.repository';

@Injectable()
export class KycFileService {
  constructor(private readonly kycFileRepository: KycFileRepository) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.SYNC_FILE_SUB_TYPE, timeout: 7200 })
  async syncFileSubType() {
    const entities = await this.kycFileRepository.find({
      where: { type: In([FileType.USER_NOTES, FileType.NAME_CHECK]), subType: IsNull() },
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

      if (entity.subType) await this.kycFileRepository.update(entity.id, { subType: entity.subType });
    }
  }

  async createKycFile(dto: CreateKycFileDto): Promise<KycFile> {
    const entity = this.kycFileRepository.create(dto);

    const hash = Util.createHash(entity.type + new Date() + Util.randomId()).toUpperCase();
    entity.uid = `F${hash.slice(0, 16)}`;

    return this.kycFileRepository.save(entity);
  }

  async getKycFile(uid: string, relations?: FindOptionsRelations<KycFile>): Promise<KycFile> {
    return this.kycFileRepository.findOne({
      where: { uid },
      relations,
    });
  }
}
