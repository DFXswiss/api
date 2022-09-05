import { Blockchain } from 'src/ain/node/node.service';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class GetCryptoPaymentInfoDto {
  @ApiProperty({ description: 'Source blockchain' })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty({ description: 'Target asset' })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  asset: Asset;
}
