import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export abstract class WithdrawalOrderBase {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  key: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  network: string;
}

export class WithdrawalOrder extends WithdrawalOrderBase {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number; // withdraws whole amount, if unset
}
