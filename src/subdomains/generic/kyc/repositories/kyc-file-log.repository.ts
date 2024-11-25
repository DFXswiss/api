import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { KycFileLog } from '../entities/kyc-file-log.entity';

@Injectable()
export class KycFileLogRepository extends BaseRepository<KycFileLog> {
  constructor(manager: EntityManager) {
    super(KycFileLog, manager);
  }
}
