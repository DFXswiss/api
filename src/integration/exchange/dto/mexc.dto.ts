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
  transHash: string;
  insertTime: number;
  updateTime: number;
  unlockConfirm: string;
  confirmTimes: string;
  memo?: string;
}

export enum WithdrawalStatus {
  APPLY = 1,
  AUDITING = 2,
  WAIT = 3,
  PROCESSING = 4,
  WAIT_PACKAGING = 5,
  WAIT_CONFIRM = 6,
  SUCCESS = 7,
  FAILED = 8,
  CANCEL = 9,
  MANUAL = 10,
}

export interface Withdrawal {
  id: string;
  txId: string | null;
  coin: string;
  network: string;
  address: string;
  amount: string;
  transferType: number;
  status: WithdrawalStatus;
  transactionFee: string;
  confirmNo: number | null;
  applyTime: number;
  remark: string;
  memo: string;
  transHash: string;
  updateTime: number;
  coinId: string;
  vcoinId: string;
}
