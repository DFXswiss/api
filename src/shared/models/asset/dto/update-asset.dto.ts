import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AssetType } from '../asset.entity';

export class UpdateAssetDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  chainId: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  minDepositAmount: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  name: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  dexName: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  sellCommand: string;

  @ApiProperty()
  @IsOptional()
  @IsEnum(AssetType)
  type: AssetType;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  isLP: boolean;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  sellable: boolean;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  buyable: boolean;
}
