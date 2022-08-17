import { Blockchain } from 'src/ain/services/crypto.service';
import { HistoryFilterKey } from 'src/payment/models/history/dto/history-filter.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { AccountType } from '../../user-data/account-type.enum';
import { KycState, KycStatus } from '../../user-data/user-data.entity';
import { UserStatus } from '../user.entity';
import { LinkedUserDto } from './linked-user.dto';

export interface UserDto {
  accountType: AccountType;
  address: string;
  blockchain: Blockchain;
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
  apiFilterCT: HistoryFilterKey[];
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

  linkedAddresses?: LinkedUserDto[];
}

export type UserDetailDto = UserDto & UserDetails;
