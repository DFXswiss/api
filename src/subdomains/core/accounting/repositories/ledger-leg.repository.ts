import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LedgerLeg } from '../entities/ledger-leg.entity';

@Injectable()
export class LedgerLegRepository extends BaseRepository<LedgerLeg> {
  constructor(manager: EntityManager) {
    super(LedgerLeg, manager);
  }
}
