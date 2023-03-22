import { IsNotEmpty, IsNumber } from 'class-validator';

export class EvmTokenBridgeApproval {
  @IsNotEmpty()
  @IsNumber()
  l1AssetId: number;

  @IsNotEmpty()
  @IsNumber()
  l2AssetId: number;
}
