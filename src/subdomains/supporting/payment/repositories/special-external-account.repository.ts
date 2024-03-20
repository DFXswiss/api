import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SpecialExternalAccount } from '../entities/special-external-account.entity';

@Injectable()
export class SpecialExternalAccountRepository extends BaseRepository<SpecialExternalAccount> {
  constructor(manager: EntityManager) {
    super(SpecialExternalAccount, manager);
  }
}
