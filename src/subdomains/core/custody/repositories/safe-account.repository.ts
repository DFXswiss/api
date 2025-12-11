import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SafeAccount } from '../entities/safe-account.entity';

@Injectable()
export class SafeAccountRepository extends BaseRepository<SafeAccount> {
  constructor(manager: EntityManager) {
    super(SafeAccount, manager);
  }
}
