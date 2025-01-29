export enum SupportIssueState {
  CREATED = 'Created',
  PENDING = 'Pending',
  COMPLETED = 'Completed',
}

export enum SupportIssueType {
  GENERIC_ISSUE = 'GenericIssue',
  TRANSACTION_ISSUE = 'TransactionIssue',
  KYC_ISSUE = 'KycIssue',
  LIMIT_REQUEST = 'LimitRequest',
  PARTNERSHIP_REQUEST = 'PartnershipRequest',
  NOTIFICATION_OF_CHANGES = 'NotificationOfChanges',
  BUG_REPORT = 'BugReport',
}

export enum SupportIssueReason {
  OTHER = 'Other',
  DATA_REQUEST = 'DataRequest',

  // transaction
  FUNDS_NOT_RECEIVED = 'FundsNotReceived',
  TRANSACTION_MISSING = 'TransactionMissing',
}
