import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

@Injectable()
export class TransactionSpecificationService {
  constructor(private readonly transactionSpecificationRepo: TransactionSpecificationRepository) {}

  private transactionSpecifications: TransactionSpecification[];
  getTransactionSpecification(
    fromSystem: string,
    toSystem: string,
    fromAsset?: string,
    toAsset?: string,
  ): { minFee: number; minVolume: number } {
    let outSpec = this.transactionSpecifications.find(
      (t) => t.system == fromSystem && t.asset == fromAsset && t.direction == TransactionDirection.OUT,
    );

    if (!outSpec)
      outSpec = this.transactionSpecifications.find(
        (t) => t.system == fromSystem && t.asset == null && t.direction == TransactionDirection.OUT,
      );

    let inSpec = this.transactionSpecifications.find(
      (t) => t.system == toSystem && t.asset == toAsset && t.direction == TransactionDirection.IN,
    );

    if (!inSpec)
      inSpec = this.transactionSpecifications.find(
        (t) => t.system == toSystem && t.asset == null && t.direction == TransactionDirection.IN,
      );

    return { minFee: outSpec.minFee + inSpec.minFee, minVolume: Math.max(outSpec.minVolume, inSpec.minVolume) };
  }

  onModuleInit() {
    void this.dailyUpdate();
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async dailyUpdate() {
    this.transactionSpecifications = await this.transactionSpecificationRepo.find();
  }
}
