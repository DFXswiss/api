import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaymentStatus } from '../payment.entity';

export class UpdatePaymentDto {
  @ApiProperty()
  @IsInt()
  id: number;

  @IsOptional()
  @IsString()
  info: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(PaymentStatus)
  status: PaymentStatus;
}
