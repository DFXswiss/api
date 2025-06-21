import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { CreatePaymentLinkPaymentDto } from './create-payment-link-payment.dto';
import { UpdatePaymentLinkConfigDto } from './payment-link-config.dto';

export class CreatePaymentLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  routeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  route?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  webhookUrl?: string;

  @ApiPropertyOptional({ type: CreatePaymentLinkPaymentDto })
  @IsOptional()
  @Type(() => CreatePaymentLinkPaymentDto)
  @ValidateNested()
  payment?: CreatePaymentLinkPaymentDto;

  @ApiPropertyOptional({ type: UpdatePaymentLinkConfigDto })
  @IsOptional()
  @Type(() => UpdatePaymentLinkConfigDto)
  @ValidateNested()
  config?: UpdatePaymentLinkConfigDto;
}
