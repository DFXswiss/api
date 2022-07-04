import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export interface SystemState {
  [subsystem: string]: SubsystemState;
}

export interface SubsystemState {
  [metric: string]: Metric;
}

export interface Metric {
  data: unknown;
  updated: Date;
  status: MetricUpdateStatus;
}

export enum MetricUpdateStatus {
  AVAILABLE = 'Available',
  NOT_AVAILABLE = 'NotAvailable',
}

export type SubsystemName = string;
export type MetricName = string;

@Entity()
export class SystemStateRecord extends IEntity {
  @Column({ type: 'datetime2', nullable: false })
  timestamp: Date;

  @Column({ nullable: false })
  data: string;
}
