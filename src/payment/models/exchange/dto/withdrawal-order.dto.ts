import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class WithdrawalOrder {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  amount?: number; // withdraws whole amount, if unset

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  key: string;
}
