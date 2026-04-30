import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { KycLog } from '../entities/kyc-log.entity';

@Injectable()
export class KycLogRepository extends BaseRepository<KycLog> {
  constructor(manager: EntityManager) {
    super(KycLog, manager);
  }
}
