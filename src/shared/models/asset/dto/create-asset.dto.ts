import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AssetType } from '../asset.entity';

export class CreateAssetDto {
  @ApiProperty()
  @IsNotEmpty()
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
  @IsNumber()
  chainId: number;

  @ApiProperty()
  @IsOptional()
  @IsNumber()
  minDepositAmount: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(AssetType)
  type: AssetType;

  @ApiProperty()
  @IsOptional()
  @IsBoolean()
  isLP: boolean;

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
