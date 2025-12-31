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
  accountServiceRef: string;
  amount: number;
  currency: string;
  type: BankTxType;
  name?: string;
}

export class UserDataSupportInfoDetails {
  userData: UserData;
  kycFiles: KycFile[];
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
  VIBAN = 'VirtualIban',
  TRANSACTION_UID = 'TransactionUid',
}
