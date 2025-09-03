export enum DepositStatus {
  SMALL = 1,
  TIME_DELAY = 2,
  LARGE_DELAY = 3,
  PENDING = 4,
  SUCCESS = 5,
  AUDITING = 6,
  REJECTED = 7,
  REFUND = 8,
  PRE_SUCCESS = 9,
  INVALID = 10,
  RESTRICTED = 11,
  COMPLETED = 12,
}

export interface Deposit {
  amount: string;
  coin: string;
  network: string;
  status: DepositStatus;
  address: string;
  addressTag?: string;
  txId: string;
  insertTime: number;
  updateTime: number;
  unlockConfirm: string;
  confirmTimes: string;
  memo?: string;
}
