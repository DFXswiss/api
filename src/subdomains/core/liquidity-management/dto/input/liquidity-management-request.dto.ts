import { IsInt, IsNotEmpty, IsNumber } from 'class-validator';

export class LiquidityManagementRequestDto {
  @IsNotEmpty()
  @IsInt()
  assetId: number;

  @IsNotEmpty()
  @IsNumber()
  amount: number;
}
