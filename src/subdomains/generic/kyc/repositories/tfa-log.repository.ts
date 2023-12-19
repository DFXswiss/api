import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TfaLog } from '../entities/totp-auth-log.entity';

@Injectable()
export class TfaLogRepository extends BaseRepository<TfaLog> {
  constructor(manager: EntityManager) {
    super(TfaLog, manager);
  }
}
