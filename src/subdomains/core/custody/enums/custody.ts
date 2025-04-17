export enum CustodyAddressType {
  EVM = 'EVM',
}

export enum CustodyOrderType {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',
  SWAP = 'Swap',
  SAVING_DEPOSIT = 'SavingDeposit',
  SAVING_WITHDRAWAL = 'SavingWithdrawal',
}

export enum CustodyOrderStatus {
  CREATED = 'Created',
  CONFIRMED = 'Confirmed',
  APPROVED = 'Approved',
  IN_PROGRESS = 'InProgress',
  COMPLETED = 'Completed',
}

export enum CustodyOrderStepStatus {
  CREATED = 'Created',
  IN_PROGRESS = 'InProgress',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
}

export enum CustodyOrderStepContext {
  DFX = 'DFX',
}
