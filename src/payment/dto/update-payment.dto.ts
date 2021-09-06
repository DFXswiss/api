import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaymentStatus } from '../payment.entity';

export class UpdatePaymentDto {
  @ApiProperty()
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  info: string;

  @ApiProperty()
  @IsOptional()
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsOptional()
  @IsBoolean()
  accepted: boolean
}
