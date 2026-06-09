import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel, KycType, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';

export class DebugUserQueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  mail: string;
}

// Only non-PII fields: enough to identify and disambiguate accounts (a mail can map to
// several user_data rows through test aliases or merges) without exposing personal data.
export interface DebugUserResult {
  userDataId: number;
  accountType: AccountType | null;
  kycLevel: KycLevel;
  kycType: KycType;
  status: UserDataStatus;
  wallet: string | null;
  created: Date;
}
