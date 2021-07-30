import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AssetType } from '../asset.entity';

export class UpdateAssetDto {
  @ApiProperty()
  @IsNotEmpty()
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
  sellable: boolean;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  buyable: boolean;

  @IsString()
  @IsOptional()
  created: Date;
}
