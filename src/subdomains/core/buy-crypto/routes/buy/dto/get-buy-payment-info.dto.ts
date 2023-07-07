import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsNotEmptyObject, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';

export class GetBuyPaymentInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsDfxIban()
  @Transform(Util.trim)
  iban?: string;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;
}
