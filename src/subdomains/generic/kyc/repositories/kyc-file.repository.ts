import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { KycFile } from '../entities/kyc-file.entity';

@Injectable()
export class KycFileRepository extends BaseRepository<KycFile> {
  constructor(manager: EntityManager) {
    super(KycFile, manager);
  }
}
