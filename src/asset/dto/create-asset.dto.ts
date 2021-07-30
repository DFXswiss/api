import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AssetType } from '../asset.entity';

export class CreateAssetDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
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

  @IsString()
  @IsOptional()
  created: Date;
}
