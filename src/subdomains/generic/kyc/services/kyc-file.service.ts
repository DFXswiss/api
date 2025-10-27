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

    entity.uid = `${Config.prefixes.kycFileUidPrefix}${Util.randomString(16)}`;

    return this.kycFileRepository.save(entity);
  }

  async getKycFile(uid: string, relations?: FindOptionsRelations<KycFile>): Promise<KycFile> {
    return this.kycFileRepository.findOne({
      where: { uid },
      relations,
    });
  }

  async getUserDataKycFiles(userDataId: number): Promise<KycFile[]> {
    return this.kycFileRepository.findCached(`userData-${userDataId}`, {
      where: { userData: { id: userDataId } },
      loadEagerRelations: false,
    });
  }
}
