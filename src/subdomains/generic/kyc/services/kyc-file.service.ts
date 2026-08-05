import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { FindOptionsRelations } from 'typeorm';
import { CreateKycFileDto, FileSubType } from '../dto/kyc-file.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { KycFileRepository } from '../repositories/kyc-file.repository';

@Injectable()
export class KycFileService {
  constructor(private readonly kycFileRepository: KycFileRepository) {}

  async createKycFile(dto: CreateKycFileDto): Promise<KycFile> {
    const entity = this.kycFileRepository.create(dto);

    entity.uid = Util.createUid(Config.prefixes.kycFileUidPrefix);

    const saved = await this.kycFileRepository.save(entity);

    // Invalidate cache so new files are visible immediately
    this.kycFileRepository.invalidateCache();

    return saved;
  }

  async getKycFile(uid: string, relations?: FindOptionsRelations<KycFile>): Promise<KycFile> {
    return this.kycFileRepository.findOne({
      where: { uid },
      relations,
    });
  }

  // Whether ONE ident step has its report, asked per step rather than per account: an account can
  // carry reports from earlier idents — a previous Sumsub run, or a Spider-era document catalogued
  // from the legacy storage — and none of those say anything about the step being reviewed now.
  // Uncached and unjoined on purpose: the caller asks it while deciding whether an ident may advance,
  // so it has to see the row a webhook wrote seconds ago.
  async hasIdentReport(kycStepId: number): Promise<boolean> {
    return this.kycFileRepository.exists({
      where: { kycStep: { id: kycStepId }, subType: FileSubType.IDENT_REPORT },
      loadEagerRelations: false,
    });
  }

  async getUserDataKycFiles(userDataId: number, relations: FindOptionsRelations<KycFile> = {}): Promise<KycFile[]> {
    return this.kycFileRepository.findCached(`userData-${userDataId}-${JSON.stringify(relations)}`, {
      where: { userData: { id: userDataId } },
      relations,
      loadEagerRelations: false,
    });
  }
}
