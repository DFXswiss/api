import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentLinkPaymentMode } from './payment-link.dto';

export class CreatePaymentLinkPaymentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(PaymentLinkPaymentMode)
  mode: PaymentLinkPaymentMode;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiProperty()
  @IsOptional()
  expiryDate: Date;
}
