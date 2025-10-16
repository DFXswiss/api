import { IsNotEmpty } from 'class-validator';

export class UserDataSupportInfo {
  userDataId: number;
  kycStatus: string;
  accountType?: string;
  mail?: string;
  verifiedName?: string;
}

export class UserDataSupportQuery {
  @IsNotEmpty()
  key: string;
}
