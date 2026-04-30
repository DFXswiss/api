import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyAccount } from '../entities/custody-account.entity';

@Injectable()
export class CustodyAccountRepository extends BaseRepository<CustodyAccount> {
  constructor(manager: EntityManager) {
    super(CustodyAccount, manager);
  }
}
