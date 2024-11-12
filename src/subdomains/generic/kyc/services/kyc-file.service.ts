import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { FindOptionsRelations } from 'typeorm';
import { CreateKycFileDto, UpdateKycFileDto } from '../dto/kyc-file.dto';
import { KycFile } from '../entities/kyc-file.entity';
import { KycFileRepository } from '../repositories/kyc-file.repository';

@Injectable()
export class KycFileService {
  constructor(private readonly kycFileRepository: KycFileRepository) {}

  async createKycFile(dto: CreateKycFileDto): Promise<KycFile> {
    const entity = this.kycFileRepository.create(dto);

    const hash = Util.createHash(entity.type + new Date() + Util.randomId()).toUpperCase();
    entity.uid = `F${hash.slice(0, 16)}`;

    return this.kycFileRepository.save(entity);
  }

  async updateKycFile(uniqueId: string, dto: UpdateKycFileDto): Promise<KycFile> {
    const entity = await this.kycFileRepository.findOne({
      where: { uid: uniqueId },
      relations: { userData: true, kycStep: true },
    });
    if (!entity) throw new NotFoundException('Route not found');

    const update = this.kycFileRepository.create(dto);

    if (update.name && (await this.kycFileRepository.existsBy({ name: update.name })))
      throw new BadRequestException('Label already in use');

    return this.kycFileRepository.save(Object.assign(entity, update));
  }

  async getKycFile(uid: string, relations?: FindOptionsRelations<KycFile>): Promise<KycFile> {
    return this.kycFileRepository.findOneOrFail({
      where: { uid },
      relations,
    });
  }
}
