export enum CustodyAddressType {
  EVM = 'EVM',
}

export enum CustodyActionType {
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
  COMPLETED = 'Completed',
}
