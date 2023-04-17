import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';
import { TransactionDirection, TransactionSpecification } from '../entities/transaction-specification.entity';
import { TransactionSpecificationRepository } from '../repositories/transaction-specification.repository';

@Injectable()
export class TransactionSpecificationService {
  constructor(private readonly transactionSpecificationRepo: TransactionSpecificationRepository) {}

  private transactionSpecifications: TransactionSpecification[];
  get(
    fromSystem: string,
    fromAsset: string | undefined,
    toSystem: string,
    toAsset: string | undefined,
  ): { minFee: MinAmount; minDeposit: MinAmount } {
    const inSpec = this.getSpec(fromSystem, fromAsset, TransactionDirection.IN);
    const outSpec = this.getSpec(toSystem, toAsset, TransactionDirection.OUT);

    return {
      minFee: { amount: outSpec.minFee + inSpec.minFee, asset: 'EUR' },
      minDeposit: { amount: Math.max(outSpec.minVolume, inSpec.minVolume), asset: 'EUR' },
    };
  }

  private getSpec(system: string, asset: string | undefined, direction: TransactionDirection | undefined) {
    return (
      this.findSpec(system, asset, direction) ??
      this.findSpec(system, undefined, direction) ??
      this.findSpec(system, asset, undefined) ??
      this.findSpec(system, undefined, undefined)
    );
  }

  private findSpec(system: string, asset: string | undefined, direction: TransactionDirection | undefined) {
    return this.transactionSpecifications.find(
      (t) => t.system == system && t.asset == asset && t.direction == direction,
    );
  }

  onModuleInit() {
    void this.dailyUpdate();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async dailyUpdate() {
    this.transactionSpecifications = await this.transactionSpecificationRepo.find();
  }
}
