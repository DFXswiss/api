export enum SupportIssueInternalState {
  CREATED = 'Created',
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELED = 'Canceled',
  ON_HOLD = 'OnHold',
}

export enum SupportIssueType {
  GENERIC_ISSUE = 'GenericIssue',
  TRANSACTION_ISSUE = 'TransactionIssue',
  VERIFICATION_CALL = 'VerificationCall',
  KYC_ISSUE = 'KycIssue',
  LIMIT_REQUEST = 'LimitRequest',
  PARTNERSHIP_REQUEST = 'PartnershipRequest',
  NOTIFICATION_OF_CHANGES = 'NotificationOfChanges',
  BUG_REPORT = 'BugReport',
}

export enum SupportIssueReason {
  OTHER = 'Other',
  DATA_REQUEST = 'DataRequest',

  // transaction issue
  FUNDS_NOT_RECEIVED = 'FundsNotReceived',
  TRANSACTION_MISSING = 'TransactionMissing',

  // verification call
  REJECT_CALL = 'RejectCall',
  REPEAT_CALL = 'RepeatCall',
  CALL_TIME = 'CallTime',

  // notification of changes issue
  NAME_CHANGED = 'NameChanged',
  ADDRESS_CHANGED = 'AddressChanged',
  CIVIL_STATUS_CHANGED = 'CivilStatusChanged',
}

export enum SupportIssueState {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELED = 'Canceled',
}
