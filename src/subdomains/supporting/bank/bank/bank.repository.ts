import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Bank } from './bank.entity';

@Injectable()
export class BankRepository extends BaseRepository<Bank> {
  constructor(manager: EntityManager) {
    super(Bank, manager);
  }
}
