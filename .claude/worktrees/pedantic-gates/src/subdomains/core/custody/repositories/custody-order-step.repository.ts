import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyOrderStep } from '../entities/custody-order-step.entity';

@Injectable()
export class CustodyOrderStepRepository extends BaseRepository<CustodyOrderStep> {
  constructor(manager: EntityManager) {
    super(CustodyOrderStep, manager);
  }
}
