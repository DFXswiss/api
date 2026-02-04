import { IsNotEmpty } from 'class-validator';
import { BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { KycFile } from '../../kyc/entities/kyc-file.entity';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycStatus } from '../../user/models/user-data/user-data.enum';

export class UserDataSupportInfoResult {
  type: ComplianceSearchType;
  userDatas: UserDataSupportInfo[];
  bankTx: BankTxSupportInfo[];
}

export class UserDataSupportInfo {
  id: number;
  kycStatus: KycStatus;
  accountType?: AccountType;
  mail?: string;
  name?: string;
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
}

export class UserSupportInfo {
  id: number;
  address: string;
  role: string;
  status: string;
  created: Date;
}

export class TransactionSupportInfo {
  id: number;
  uid: string;
  type?: string;
  sourceType: string;
  amountInChf?: number;
  amlCheck?: string;
  created: Date;
}

export class KycStepSupportInfo {
  id: number;
  name: string;
  type?: string;
  status: string;
  sequenceNumber: number;
  created: Date;
}

export class BankDataSupportInfo {
  id: number;
  iban: string;
  name: string;
  approved: boolean;
}

export class BuySupportInfo {
  id: number;
  bankUsage: string;
  assetName: string;
  blockchain: string;
  volume: number;
  active: boolean;
}

export class SellSupportInfo {
  id: number;
  iban: string;
  fiatName?: string;
  volume: number;
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
  highRisk?: boolean;
  pep?: boolean;
  complexOrgStructure?: boolean;
  totalVolumeChfAuditPeriod?: number;
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

export class UserDataSupportInfoDetails {
  userData: UserData;
  kycFiles: KycFile[];
  kycSteps: KycStepSupportInfo[];
  transactions: TransactionSupportInfo[];
  users: UserSupportInfo[];
  bankDatas: BankDataSupportInfo[];
  buyRoutes: BuySupportInfo[];
  sellRoutes: SellSupportInfo[];
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
