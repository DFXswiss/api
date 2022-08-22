import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNotEmptyObject, IsNumber, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class CreateBuyPaymentInfoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;

  @ApiProperty()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;
}
