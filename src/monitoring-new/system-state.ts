export interface SystemState {
  [subsystem: string]: SubsystemState;
}

export interface SubsystemState {
  [metric: string]: Metric<unknown>;
}

export interface Metric<T> {
  data: T;
  updated: Date;
  status: MetricUpdateStatus;
}

export enum MetricUpdateStatus {
  AVAILABLE = 'Available',
  NOT_AVAILABLE = 'NotAvailable',
}

export type SubsystemName = string;
export type MetricName = string;
