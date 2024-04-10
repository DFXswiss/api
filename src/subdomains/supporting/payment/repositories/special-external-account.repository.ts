import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { SpecialExternalAccount } from '../entities/special-external-account.entity';

@Injectable()
export class SpecialExternalAccountRepository extends CachedRepository<SpecialExternalAccount> {
  constructor(manager: EntityManager) {
    super(SpecialExternalAccount, manager);
  }
}
