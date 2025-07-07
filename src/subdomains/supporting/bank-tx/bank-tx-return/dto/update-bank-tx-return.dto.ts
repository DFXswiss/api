import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { BankTx } from '../../bank-tx/entities/bank-tx.entity';

export class UpdateBankTxReturnDto {
  @IsOptional()
  @IsString()
  info?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  chargebackBankTx?: BankTx;

  @IsOptional()
  @IsNumber()
  amountInChf?: number;

  @IsOptional()
  @IsNumber()
  amountInEur?: number;

  @IsOptional()
  @IsNumber()
  amountInUsd?: number;
}
