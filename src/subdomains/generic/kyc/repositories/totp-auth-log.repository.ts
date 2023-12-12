import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TotpAuthLog } from '../entities/totp-auth-log.entity';

@Injectable()
export class TotpAuthLogRepository extends BaseRepository<TotpAuthLog> {
  constructor(manager: EntityManager) {
    super(TotpAuthLog, manager);
  }
}
