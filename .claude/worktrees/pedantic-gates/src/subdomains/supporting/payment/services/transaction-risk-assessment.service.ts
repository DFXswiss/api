import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateRiskAssessmentDto, UpdateRiskAssessmentDto } from '../dto/risk-assessment.dto';
import { TransactionRiskAssessment } from '../entities/transaction-risk-assessment.entity';
import { TransactionRiskAssessmentRepository } from '../repositories/transaction-risk-assessment.repository';

@Injectable()
export class TransactionRiskAssessmentService {
  constructor(private readonly repo: TransactionRiskAssessmentRepository) {}

  async create(transactionId: number, dto: CreateRiskAssessmentDto): Promise<TransactionRiskAssessment> {
    const entity = this.repo.create({
      ...dto,
      transaction: { id: transactionId },
    });

    return this.repo.save(entity);
  }

  async update(riskId: number, dto: UpdateRiskAssessmentDto): Promise<TransactionRiskAssessment> {
    const entity = await this.repo.findOneBy({ id: riskId });
    if (!entity) throw new NotFoundException('Risk assessment not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }
}
