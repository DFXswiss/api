import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateInvoicePaymentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  routeId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  externalId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  currency: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;
}
