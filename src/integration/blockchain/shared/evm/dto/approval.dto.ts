import { IsInt, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class EvmTokenBridgeApproval {
  @IsNotEmpty()
  @IsNumber()
  l1AssetId: number;

  @IsNotEmpty()
  @IsNumber()
  l2AssetId: number;
}

export class EvmTokenApproval {
  @IsNotEmpty()
  @IsInt()
  assetId: number;

  @IsNotEmpty()
  @IsString()
  contractAddress: string;
}
