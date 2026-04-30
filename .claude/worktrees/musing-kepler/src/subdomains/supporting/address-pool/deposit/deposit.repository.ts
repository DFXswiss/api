import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Deposit } from './deposit.entity';

@Injectable()
export class DepositRepository extends BaseRepository<Deposit> {
  constructor(manager: EntityManager) {
    super(Deposit, manager);
  }
}
