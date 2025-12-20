import { IsInt, IsNumber, Min } from 'class-validator';

export class ManualLogPositionDto {
  @IsInt()
  @Min(1)
  assetId: number;

  @IsNumber()
  value: number;
}
