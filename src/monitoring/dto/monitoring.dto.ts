export interface BalanceStatus {
  actual: number;
  should: number;
  difference: number;
  status: MonitoringStatus;
}

export enum MonitoringStatus {
  OK = 'ok',
  WARNING = 'warning',
}
