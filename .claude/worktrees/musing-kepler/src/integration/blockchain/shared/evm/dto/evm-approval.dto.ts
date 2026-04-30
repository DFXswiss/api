import { IsInt, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class EvmBridgeApproval {
  @IsNotEmpty()
  @IsNumber()
  l1AssetId: number;

  @IsNotEmpty()
  @IsNumber()
  l2AssetId: number;
}

export class EvmContractApproval {
  @IsNotEmpty()
  @IsInt()
  assetId: number;

  @IsNotEmpty()
  @IsString()
  contractAddress: string;
}
