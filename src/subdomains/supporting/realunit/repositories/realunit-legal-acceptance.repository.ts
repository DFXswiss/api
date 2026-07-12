import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { RealUnitLegalAcceptance } from '../entities/realunit-legal-acceptance.entity';

@Injectable()
export class RealUnitLegalAcceptanceRepository extends BaseRepository<RealUnitLegalAcceptance> {
  constructor(manager: EntityManager) {
    super(RealUnitLegalAcceptance, manager);
  }
}
