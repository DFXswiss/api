import { IsEnum, IsNotEmpty } from 'class-validator';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { Notification } from 'src/subdomains/supporting/notification/entities/notification.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportMessage } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { LimitRequest } from '../../../supporting/support-issue/entities/limit-request.entity';
import { KycFileBlob } from '../../kyc/dto/kyc-file.dto';
import { KycStep } from '../../kyc/entities/kyc-step.entity';
import { BankData } from '../../user/models/bank-data/bank-data.entity';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { SupportTable } from '../gs.service';

export class SupportReturnData {
  userData: UserData;
  supportIssues: SupportIssue[];
  supportMessages: SupportMessage[];
  limitRequests: LimitRequest[];
  kycSteps: KycStep[];
  bankData: BankData[];
  notification: Notification[];
  documents: KycFileBlob[];
  buyCrypto: BuyCrypto[];
  buyFiat: BuyFiat[];
  ref: BuyCrypto[];
  refReward: RefReward[];
  cryptoInput: CryptoInput[];
  bankTxRepeat: BankTxRepeat[];
}

export class SupportDataQuery {
  @IsNotEmpty()
  @IsEnum(SupportTable)
  table: SupportTable;

  @IsNotEmpty()
  key: string;

  @IsNotEmpty()
  value: any;
}
