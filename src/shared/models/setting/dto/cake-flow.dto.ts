import { IsEnum, IsNotEmpty } from 'class-validator';

export enum CakeAssetDirection {
  KRAKEN = 'Kraken',
  DEFICHAIN = 'DeFiChain',
}

export class CakeFlowAssetDto {
  @IsNotEmpty()
  @IsEnum(CakeAssetDirection)
  direction: CakeAssetDirection;

  @IsNotEmpty()
  threshold: number;
}

export class CakeSettings {
  assets: {
    [asset: string]: CakeFlowAssetDto;
  };
}

export class CakeFlowDto extends CakeFlowAssetDto {
  @IsNotEmpty()
  asset: string;
}
