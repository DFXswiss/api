import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyAccountAccess } from '../entities/custody-account-access.entity';

@Injectable()
export class CustodyAccountAccessRepository extends BaseRepository<CustodyAccountAccess> {
  constructor(manager: EntityManager) {
    super(CustodyAccountAccess, manager);
  }
}
