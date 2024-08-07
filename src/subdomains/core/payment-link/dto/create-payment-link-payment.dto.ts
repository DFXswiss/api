import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNotEmptyObject,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { PaymentLinkPaymentMode } from './payment-link.dto';

export class CreatePaymentLinkPaymentDto {
  @ApiProperty({ enum: PaymentLinkPaymentMode })
  @IsNotEmpty()
  @IsEnum(PaymentLinkPaymentMode)
  mode: PaymentLinkPaymentMode;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId: string;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;
}
