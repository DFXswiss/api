import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

export enum CakeAssetDirection {
  KRAKEN = 'Kraken',
  DEFICHAIN = 'DeFiChain',
}

export class CakeFlowAssetDto {
  @ApiProperty({ enum: CakeAssetDirection })
  direction: CakeAssetDirection;

  @ApiProperty()
  threshold: number;
}

export class CakeFlow {
  [x: string]: any;
  @ApiProperty()
  assets: {
    [asset: string]: CakeFlowAssetDto;
  };
}

export class CakeFlowDto {
  @ApiProperty()
  @IsNotEmpty()
  asset: string;

  @ApiProperty({ enum: CakeAssetDirection })
  @IsNotEmpty()
  @IsEnum(CakeAssetDirection)
  direction: CakeAssetDirection;

  @ApiProperty()
  @IsNotEmpty()
  threshold: number;
}
