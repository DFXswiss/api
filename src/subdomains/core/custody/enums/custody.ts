export enum CustodyAddressType {
  EVM = 'EVM',
}

export enum CustodyOrderType {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',

  RECEIVE = 'Receive',
  SEND = 'Send',

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

export enum CustodyOrderStepCommand {
  CHARGE_ROUTE = 'ChargeRoute',
  SEND_TO_ROUTE = 'SendToRoute',
}

export const CustodyOrderInputTypes = [
  CustodyOrderType.DEPOSIT,
  CustodyOrderType.RECEIVE,
  CustodyOrderType.SWAP,
  CustodyOrderType.SAVING_DEPOSIT,
];

export const CustodyOrderOutputTypes = [
  CustodyOrderType.WITHDRAWAL,
  CustodyOrderType.SEND,
  CustodyOrderType.SWAP,
  CustodyOrderType.SAVING_WITHDRAWAL,
];
