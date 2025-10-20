import { IsNotEmpty } from 'class-validator';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { KycStatus } from '../../user/models/user-data/user-data.enum';

export class UserDataSupportInfo {
  id: number;
  kycStatus: KycStatus;
  accountType?: AccountType;
  mail?: string;
  name?: string;
}

export class UserDataSupportQuery {
  @IsNotEmpty()
  key: string;
}
