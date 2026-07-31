import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { FindOptionsRelations } from 'typeorm';
import { CreateKycFileDto } from '../dto/kyc-file.dto';
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

  async getByGenerationKey(generationKey: string): Promise<KycFile | null> {
    return this.kycFileRepository.findOne({ where: { generationKey } });
  }

  async markValid(file: KycFile): Promise<void> {
    await this.kycFileRepository.update(file.id, { valid: true });
    file.valid = true;
    this.kycFileRepository.invalidateCache();
  }

  async getUserDataKycFiles(userDataId: number, relations: FindOptionsRelations<KycFile> = {}): Promise<KycFile[]> {
    return this.kycFileRepository.findCached(`userData-${userDataId}-${JSON.stringify(relations)}`, {
      where: { userData: { id: userDataId } },
      relations,
      loadEagerRelations: false,
    });
  }
}
