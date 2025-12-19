import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { KycFile } from '../entities/kyc-file.entity';

@Injectable()
export class KycFileRepository extends CachedRepository<KycFile> {
  constructor(manager: EntityManager) {
    super(KycFile, manager);
  }
}
