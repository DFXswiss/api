import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { GoodsCategory, GoodsType, MerchantMCC, StoreType } from 'src/integration/c2b-payment-link/dto/binance.dto';
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
  route?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiPropertyOptional({ enum: StoreType })
  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;

  @ApiPropertyOptional({ enum: MerchantMCC })
  @IsOptional()
  @IsEnum(MerchantMCC)
  merchantMcc?: MerchantMCC;

  @ApiPropertyOptional({ enum: GoodsType })
  @IsOptional()
  @IsEnum(GoodsType)
  goodsType?: GoodsType;

  @ApiPropertyOptional({ enum: GoodsCategory })
  @IsOptional()
  @IsEnum(GoodsCategory)
  goodsCategory?: GoodsCategory;
}
