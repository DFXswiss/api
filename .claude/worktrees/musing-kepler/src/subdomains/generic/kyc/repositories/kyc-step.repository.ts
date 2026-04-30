import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { KycStep } from '../entities/kyc-step.entity';

@Injectable()
export class KycStepRepository extends BaseRepository<KycStep> {
  constructor(manager: EntityManager) {
    super(KycStep, manager);
  }
}
