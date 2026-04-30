import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Bank } from './bank.entity';

@Injectable()
export class BankRepository extends CachedRepository<Bank> {
  constructor(manager: EntityManager) {
    super(Bank, manager);
  }
}
