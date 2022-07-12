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
}

export type SubsystemName = string;
export type MetricName = string;

@Entity()
export class SystemStateSnapshot extends IEntity {
  @Column({ length: 'MAX', nullable: false })
  data: string;
}
