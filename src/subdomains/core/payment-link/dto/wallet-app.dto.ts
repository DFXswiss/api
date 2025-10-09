import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';

export class WalletAppDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  websiteUrl?: string;

  @ApiProperty()
  iconUrl: string;

  @ApiPropertyOptional()
  deepLink?: string;

  @ApiPropertyOptional()
  hasActionDeepLink?: boolean;

  @ApiPropertyOptional({ description: 'Apple AppStore URL' })
  appStoreUrl?: string;

  @ApiPropertyOptional({ description: 'Google PlayStore URL' })
  playStoreUrl?: string;
  @ApiProperty({ enum: Blockchain, isArray: true })
  supportedMethods: Blockchain[];

  @ApiPropertyOptional({ type: AssetDto, isArray: true })
  supportedAssets?: AssetDto[];

  @ApiPropertyOptional()
  recommended?: boolean;

  @ApiPropertyOptional()
  semiCompatible?: boolean;

  @ApiPropertyOptional()
  active?: boolean;
}

export class WalletAppQueryDto {
  @ApiPropertyOptional({ enum: Blockchain })
  @IsOptional()
  @IsString()
  blockchain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  active: string;
}
