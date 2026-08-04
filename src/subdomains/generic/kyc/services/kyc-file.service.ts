import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { EntityManager, FindOptionsRelations } from 'typeorm';
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

  // Flags a previously created file as invalid. `uploadFile` writes the database row before the blob,
  // so a failing storage upload leaves a row pointing at a blob that does not exist - and reporting,
  // which only counts valid files, would treat the document as present. This keeps the store honest
  // instead of leaving that orphan behind.
  //
  // Inside a caller's transaction the cache is NOT dropped here: the row is not committed yet, so a
  // concurrent read between the drop and the commit would refill the cache with the still-valid row and
  // that stale entry would outlive the commit. The caller invalidates once the transaction resolved -
  // `invalidateKycFileCache` is there for exactly that.
  // Compare-and-set on `valid`, and the caller is told whether it applied: an invalidation that hit
  // nothing must not be described by an audit event as a `true -> false` transition that happened.
  async invalidateKycFile(id: number, manager?: EntityManager): Promise<boolean> {
    const result = await (manager?.getRepository(KycFile) ?? this.kycFileRepository).update(
      { id, valid: true },
      { valid: false },
    );
    if (!manager) this.invalidateKycFileCache();

    return result.affected === 1;
  }

  invalidateKycFileCache(): void {
    this.kycFileRepository.invalidateCache();
  }

  async getKycFile(uid: string, relations?: FindOptionsRelations<KycFile>): Promise<KycFile> {
    return this.kycFileRepository.findOne({
      where: { uid },
      relations,
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
