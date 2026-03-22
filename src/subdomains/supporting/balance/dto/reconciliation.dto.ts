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
  count: number;
  totalAmount: number;
  items: FlowItemDto[];
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
