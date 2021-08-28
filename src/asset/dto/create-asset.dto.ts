import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AssetType } from '../asset.entity';

export class CreateAssetDto {

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(AssetType)
  type: AssetType;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  @IsOptional()
  sellable: boolean;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  @IsOptional()
  buyable: boolean;
}
