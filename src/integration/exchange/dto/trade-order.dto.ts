import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsObject, ValidateNested, IsBoolean } from 'class-validator';
import { WithdrawalOrderBase } from './withdrawal-order.dto';

export class TradeWithdrawal extends WithdrawalOrderBase {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawAll?: boolean;
}

export class TradeOrder {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  from: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  to: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TradeWithdrawal)
  withdrawal?: TradeWithdrawal;
}
