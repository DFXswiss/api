import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TransactionRiskAssessment } from '../entities/transaction-risk-assessment.entity';

@Injectable()
export class TransactionRiskAssessmentRepository extends BaseRepository<TransactionRiskAssessment> {
  constructor(manager: EntityManager) {
    super(TransactionRiskAssessment, manager);
  }
}
