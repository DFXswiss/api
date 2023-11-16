export enum KycStepName {
  USER_DATA = 'UserData',
  IDENT = 'Ident',
  FINANCIAL = 'Financial',
  DOCUMENT_UPLOAD = 'DocumentUpload',
}

export enum KycStepType {
  // ident
  AUTO = 'Auto',
  VIDEO = 'Video',
  MANUAL = 'Manual',
  // document
  // TODO
}

export enum KycStepStatus {
  NOT_STARTED = 'NotStarted',
  IN_PROGRESS = 'InProgress',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
}
