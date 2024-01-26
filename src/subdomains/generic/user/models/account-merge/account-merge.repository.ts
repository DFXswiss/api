import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { AccountMerge } from './account-merge.entity';

@Injectable()
export class AccountMergeRepository extends BaseRepository<AccountMerge> {
  constructor(manager: EntityManager) {
    super(AccountMerge, manager);
  }
}
