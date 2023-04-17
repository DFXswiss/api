import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TransactionSpecificationService } from '../services/transaction-specification.service';

@ApiTags('transactionSpecification')
@Controller('transactionSpecification')
export class TransactionSpecificationController {
  constructor(private readonly transactionSpecificationService: TransactionSpecificationService) {}

  @Get()
  async getTransactionSpecification(
    @Query('fromSystem') fromSystem: string,
    @Query('toSystem') toSystem: string,
    @Query('fromAsset') fromAsset: string,
    @Query('toAsset') toAsset?: string,
  ): Promise<{ minFee: number; minVolume: number }> {
    return this.transactionSpecificationService.getTransactionSpecification(fromSystem, toSystem, fromAsset, toAsset);
  }
}
