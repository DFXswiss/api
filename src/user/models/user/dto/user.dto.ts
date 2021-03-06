import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { AccountType } from '../../user-data/account-type.enum';
import { KycState, KycStatus } from '../../user-data/user-data.entity';
import { UserStatus } from '../user.entity';

export interface UserDto {
  accountType: AccountType;
  address: string;
  status: UserStatus;
  usedRef: string;
  currency: Fiat;
  mail: string;
  phone: string;
  language: Language;

  kycStatus: KycStatus;
  kycState: KycState;
  kycHash: string;
  depositLimit: number;
  kycDataComplete: boolean;
  apiKeyCT: string;
}

export interface UserDetails {
  ref?: string;
  refFeePercent?: number;
  refVolume: number;
  refCredit: number;
  paidRefCredit: number;
  refCount: number;
  refCountActive: number;
  buyVolume: number;
  sellVolume: number;
  stakingBalance: number;
}

export type UserDetailDto = UserDto & UserDetails;
