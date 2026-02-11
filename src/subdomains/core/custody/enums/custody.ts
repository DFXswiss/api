export enum CustodyAddressType {
  EVM = 'EVM',
}

// orders
export enum CustodyOrderType {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',

  RECEIVE = 'Receive',
  SEND = 'Send',

  SWAP = 'Swap',

  SAVING_DEPOSIT = 'SavingDeposit',
  SAVING_WITHDRAWAL = 'SavingWithdrawal',
}

export const CustodyIncomingTypes = [CustodyOrderType.DEPOSIT, CustodyOrderType.RECEIVE];
export const CustodySwapTypes = [
  CustodyOrderType.SWAP,
  CustodyOrderType.SAVING_DEPOSIT,
  CustodyOrderType.SAVING_WITHDRAWAL,
];

export enum CustodyOrderStatus {
  CREATED = 'Created',
  CONFIRMED = 'Confirmed',
  APPROVED = 'Approved',
  IN_PROGRESS = 'InProgress',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
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

// accounts
export enum CustodyAccountStatus {
  ACTIVE = 'Active',
  BLOCKED = 'Blocked',
  CLOSED = 'Closed',
}

export enum CustodyAccessLevel {
  READ = 'Read',
  WRITE = 'Write',
}
