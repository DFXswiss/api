import { IsNotEmpty } from 'class-validator';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { RecallReason } from 'src/subdomains/supporting/recall/recall-reason.enum';
import { KycFile } from '../../kyc/entities/kyc-file.entity';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStatus, PhoneCallStatus } from '../../user/models/user-data/user-data.enum';

export class UserDataSupportInfoResult {
  type: ComplianceSearchType;
  userDatas: UserDataSupportInfo[];
  bankTx: BankTxSupportInfo[];
}

export enum OnboardingStatus {
  OPEN = 'Open',
  COMPLETED = 'Completed',
  REJECTED = 'Rejected',
}

export class UserDataSupportInfo {
  id: number;
  kycStatus: KycStatus;
  accountType?: AccountType;
  mail?: string;
  name?: string;
  onboardingStatus?: OnboardingStatus;
}

export class PendingOnboardingInfo {
  id: number;
  name?: string;
  accountType?: string;
  date: Date;
}

export enum PendingReviewType {
  KYC_STEP = 'KycStep',
  BANK_DATA = 'BankData',
}

export class PendingReviewSummaryEntry {
  type: PendingReviewType;
  name: string;
  manualReview: number;
  internalReview: number;
}

export class PendingReviewItem {
  id: number;
  userDataId: number;
  userName?: string;
  accountType?: AccountType;
  kycLevel?: number;
  date: Date;
}

export enum CallQueue {
  MANUAL_CHECK_PHONE = 'ManualCheckPhone',
  MANUAL_CHECK_IP_PHONE = 'ManualCheckIpPhone',
  MANUAL_CHECK_IP_COUNTRY_PHONE = 'ManualCheckIpCountryPhone',
  MANUAL_CHECK_EXTERNAL_ACCOUNT_PHONE = 'ManualCheckExternalAccountPhone',
  UNAVAILABLE_SUSPICIOUS = 'UnavailableSuspicious',
}

export class CallQueueSummaryEntry {
  queue: CallQueue;
  count: number;
}

export class CallQueueItem {
  queue: CallQueue;
  userDataId: number;
  userName?: string;
  phone?: string;
  language?: string;
  country?: string;
  kycLevel?: number;
  txId?: number;
  sourceType?: 'BuyCrypto' | 'BuyFiat';
  amlCheck?: CheckStatus;
  amlReason?: AmlReason;
  inputAmount?: number;
  inputAsset?: string;
  ip?: string;
  ipCountry?: string;
  phoneCallStatus?: PhoneCallStatus;
  date: Date;
}

export class BankTxSupportInfo {
  id: number;
  transactionId?: number;
  accountServiceRef: string;
  amount: number;
  currency: string;
  type: BankTxType;
  name?: string;
  iban?: string;
  remittanceInfo?: string;
  recall?: RecallSupportInfo;
}

export class RecallSupportInfo {
  id: number;
  created: Date;
  sequence: number;
  reason?: RecallReason;
  comment: string;
  fee: number;
}

export class UserSupportInfo {
  id: number;
  address: string;
  ref?: string;
  usedRef?: string;
  refUserName?: string;
  role: string;
  status: string;
  walletName?: string;
  created: Date;
}

export class TransactionSupportInfo {
  id: number;
  uid: string;
  buyCryptoId?: number;
  buyFiatId?: number;
  type?: string;
  sourceType: string;
  inputAmount?: number;
  inputAsset?: string;
  inputTxId?: string;
  outputAmount?: number;
  outputAsset?: string;
  comment?: string;
  amountInChf?: number;
  amountInEur?: number;
  amlCheck?: string;
  chargebackDate?: Date;
  amlReason?: string;
  isCompleted: boolean;
  created: Date;
}

export class RecommendationUserInfo {
  id: number;
  firstname?: string;
  surname?: string;
}

export class RecommendationEntry {
  id: number;
  recommended: RecommendationUserInfo;
  isConfirmed?: boolean;
  confirmationDate?: Date;
  created: Date;
}

export class KycStepSupportInfo {
  id: number;
  name: string;
  type?: string;
  status: string;
  sequenceNumber: number;
  result?: string;
  comment?: string;
  recommender?: RecommendationUserInfo;
  recommended?: RecommendationUserInfo;
  allRecommendations?: RecommendationEntry[];
  created: Date;
}

export class KycLogSupportInfo {
  id: number;
  type: string;
  result?: string;
  comment?: string;
  created: Date;
}

export class BankDataSupportInfo {
  id: number;
  iban: string;
  name: string;
  type?: string;
  status?: string;
  approved: boolean;
  manualApproved?: boolean;
  active: boolean;
  comment?: string;
  created: Date;
}

export class BuySupportInfo {
  id: number;
  iban?: string;
  bankUsage: string;
  assetName: string;
  blockchain: string;
  targetAddress?: string;
  targetAddressExplorerUrl?: string;
  volume: number;
  active: boolean;
  created: Date;
}

export class SellSupportInfo {
  id: number;
  iban: string;
  fiatName?: string;
  volume: number;
  active: boolean;
  created: Date;
}

export class SwapSupportInfo {
  id: number;
  assetName?: string;
  blockchain?: string;
  depositAddress?: string;
  depositAddressExplorerUrl?: string;
  volume: number;
  annualVolume: number;
  active: boolean;
  created: Date;
}

export class VirtualIbanSupportInfo {
  id: number;
  iban: string;
  bban?: string;
  currency?: string;
  bank?: string;
  status?: string;
  active: boolean;
  label?: string;
  buyId?: number;
  reservedUntil?: Date;
  activatedAt?: Date;
  deactivatedAt?: Date;
  created: Date;
}

export class NotificationSupportInfo {
  id: number;
  type: string;
  context: string;
  correlationId?: string;
  isComplete: boolean;
  error?: string;
  suppressRecurring: boolean;
  lastTryDate: Date;
  created: Date;
}

export class RefRewardSupportInfo {
  id: number;
  status?: string;
  outputAmount?: number;
  outputAsset?: string;
  outputBlockchain?: string;
  amountInChf?: number;
  amountInEur?: number;
  targetAddress?: string;
  targetAddressExplorerUrl?: string;
  txId?: string;
  txExplorerUrl?: string;
  outputDate?: Date;
  recipientMail?: string;
  mailSendDate?: Date;
  created: Date;
}

export class TransactionListEntry {
  id: number;
  type?: string;
  accountId?: number;
  kycFileId?: number;
  name?: string;
  domicile?: string;
  created?: Date;
  eventDate?: Date;
  outputDate?: Date;
  assets?: string;
  amountInChf?: number;
  highRisk?: boolean;
}

export class KycFileListEntry {
  kycFileId: number;
  id: number;
  amlAccountType?: string;
  verifiedName?: string;
  country?: { name: string };
  allBeneficialOwnersDomicile?: string;
  amlListAddedDate?: Date;
  amlListExpiredDate?: Date;
  amlListReactivatedDate?: Date;
  newOpeningInAuditPeriod?: boolean;
  highRisk?: boolean;
  pep?: boolean;
  complexOrgStructure?: boolean;
  totalVolumeChfAuditPeriod?: number;
  totalCustodyBalanceChfAuditPeriod?: number;
}

export class KycFileYearlyStats {
  year: number;
  startCount: number;
  reopened: number;
  newFiles: number;
  addedDuringYear: number;
  activeDuringYear: number;
  closedDuringYear: number;
  endCount: number;
  highestFileNr: number;
}

export class RecommendationGraphNode {
  id: number;
  firstname?: string;
  surname?: string;
  kycStatus?: string;
  kycLevel?: number;
  tradeApprovalDate?: Date;
}

export class RecommendationGraphEdge {
  id: number;
  recommenderId: number;
  recommendedId: number;
  method: string;
  type: string;
  isConfirmed?: boolean;
  confirmationDate?: Date;
  created: Date;
}

export class RecommendationGraph {
  nodes: RecommendationGraphNode[];
  edges: RecommendationGraphEdge[];
  rootId: number;
}

export class SupportMessageSupportInfo {
  author: string;
  message?: string;
  created: Date;
}

export class SupportIssueSupportInfo {
  id: number;
  uid: string;
  type: string;
  state: string;
  reason: string;
  name: string;
  clerk?: string;
  department?: string;
  information?: string;
  messages: SupportMessageSupportInfo[];
  transaction?: {
    id: number;
    uid: string;
    type?: string;
    sourceType: string;
    amountInChf?: number;
    amlCheck?: string;
  };
  limitRequest?: {
    limit: number;
    acceptedLimit?: number;
    decision?: string;
    fundOrigin: string;
  };
  created: Date;
}

export class CryptoInputSupportInfo {
  id: number;
  transactionId?: number;
  inTxId: string;
  inTxExplorerUrl?: string;
  status?: string;
  amount: number;
  assetName?: string;
  blockchain?: string;
  senderAddresses?: string;
  returnTxId?: string;
  returnTxExplorerUrl?: string;
  purpose?: string;
}

export class IpLogSupportInfo {
  id: number;
  ip: string;
  country?: string;
  url: string;
  result: boolean;
  created: Date;
}

export class UserDataSupportInfoDetails {
  userData: UserData;
  kycFiles: KycFile[];
  kycSteps: KycStepSupportInfo[];
  kycLogs: KycLogSupportInfo[];
  transactions: TransactionSupportInfo[];
  bankTxs: BankTxSupportInfo[];
  cryptoInputs: CryptoInputSupportInfo[];
  ipLogs: IpLogSupportInfo[];
  supportIssues: SupportIssueSupportInfo[];
  users: UserSupportInfo[];
  bankDatas: BankDataSupportInfo[];
  buyRoutes: BuySupportInfo[];
  sellRoutes: SellSupportInfo[];
  swapRoutes: SwapSupportInfo[];
  virtualIbans: VirtualIbanSupportInfo[];
  refRewards: RefRewardSupportInfo[];
  notifications: NotificationSupportInfo[];
}

export class UserDataSupportQuery {
  @IsNotEmpty()
  key: string;
}

export enum ComplianceSearchType {
  REF = 'Ref',
  KYC_HASH = 'KycHash',
  BANK_USAGE = 'BankUsage',
  MAIL = 'Mail',
  USER_ADDRESS = 'UserAddress',
  DEPOSIT_ADDRESS = 'DepositAddress',
  TXID = 'TxId',
  ACCOUNT_SERVICE_REF = 'AccountServiceRef',
  USER_DATA_ID = 'UserDataId',
  IP = 'IP',
  PHONE = 'Phone',
  NAME = 'Name',
  IBAN = 'Iban',
  VIRTUAL_IBAN = 'VirtualIban',
  TRANSACTION_UID = 'TransactionUid',
}
