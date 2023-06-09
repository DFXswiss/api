import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNotEmptyObject, IsNumber, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class GetSellQuoteDto {
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
