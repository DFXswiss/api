import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmptyObject, ValidateNested } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetInDto } from 'src/shared/models/asset/dto/asset.dto';

export class CreateBuyDto {
  @ApiProperty({ type: AssetInDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AssetInDto)
  asset: Asset;
}
