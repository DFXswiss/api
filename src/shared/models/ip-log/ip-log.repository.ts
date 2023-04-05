import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { IpLog } from './ip-log.entity';

@Injectable()
export class IpLogRepository extends BaseRepository<IpLog> {
  constructor(manager: EntityManager) {
    super(IpLog, manager);
  }
}
