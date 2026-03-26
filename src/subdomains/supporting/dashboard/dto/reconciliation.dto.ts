import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber } from 'class-validator';

export class ReconciliationQuery {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  assetId: number;

  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  from: Date;

  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  to: Date;
}

export interface FlowItemDto {
  id: number;
  date: Date;
  amount: number;
  reference?: string;
}

export interface FlowGroupDto {
  type: string;
  counterAccount?: string;
  counterAssetId?: number;
  count: number;
  totalAmount: number;
  items: FlowItemDto[];
}

export class OverviewQuery {
  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  from: Date;

  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  to: Date;
}

export interface PositionDto {
  asset: { id: number; uniqueName: string; blockchain: string; type: string };
  category: 'blockchain' | 'exchange' | 'bank';
  startBalance: number;
  endBalance: number;
  totalInflows: number;
  totalOutflows: number;
  expectedEndBalance: number;
  difference: number;
}

export interface ReconciliationOverviewDto {
  period: { from: Date; to: Date; actualFrom: Date; actualTo: Date };
  positions: PositionDto[];
}

export interface ReconciliationDto {
  asset: { id: number; uniqueName: string; blockchain: string; type: string };
  period: { from: Date; to: Date; actualFrom: Date; actualTo: Date };
  startBalance: number;
  endBalance: number;
  inflows: FlowGroupDto[];
  outflows: FlowGroupDto[];
  totalInflows: number;
  totalOutflows: number;
  expectedEndBalance: number;
  difference: number;
}
