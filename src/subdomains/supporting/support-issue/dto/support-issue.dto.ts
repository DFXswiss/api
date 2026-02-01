import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { TransactionSourceType, TransactionTypeInternal } from '../../payment/entities/transaction.entity';
import { FundOrigin, InvestmentDate, LimitRequestDecision } from '../entities/limit-request.entity';
import { Department } from '../enums/department.enum';
import {
  SupportIssueInternalState,
  SupportIssueReason,
  SupportIssueState,
  SupportIssueType,
} from '../enums/support-issue.enum';

export enum SupportMessageTranslationKey {
  BOT_HINT = 'support-issue.bot_hint',
  MONERO_NOT_DISPLAYED = 'support-issue.monero_not_displayed',
}

export class SupportMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  author: string;

  @ApiProperty()
  created: Date;

  @ApiPropertyOptional()
  message?: string;

  @ApiPropertyOptional()
  fileName?: string;
}

export class SupportIssueTransactionDto {
  @ApiProperty()
  uid: string;

  @ApiProperty()
  url: string;
}

export class SupportIssueLimitRequestDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  limit: number;
}

export class SupportIssueDto {
  @ApiProperty()
  uid: string;

  @ApiProperty({ enum: SupportIssueState })
  state: SupportIssueState;

  @ApiProperty({ enum: SupportIssueType })
  type: SupportIssueType;

  @ApiProperty({ enum: SupportIssueReason })
  reason: SupportIssueReason;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: Date })
  created: Date;

  @ApiProperty({ type: SupportMessageDto, isArray: true })
  messages: SupportMessageDto[];

  @ApiPropertyOptional({ type: SupportIssueTransactionDto })
  transaction?: SupportIssueTransactionDto;

  @ApiPropertyOptional({ type: SupportIssueLimitRequestDto })
  limitRequest?: SupportIssueLimitRequestDto;
}

export class SupportIssueInternalAccountDataDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: UserDataStatus })
  status: UserDataStatus;

  @ApiProperty()
  verifiedName: string;

  @ApiProperty()
  completeName: string;

  @ApiProperty({ enum: AccountType })
  accountType: AccountType;

  @ApiProperty({ enum: KycLevel })
  kycLevel: KycLevel;

  @ApiProperty()
  depositLimit: number;

  @ApiProperty()
  annualVolume: number;

  @ApiProperty()
  kycHash: string;

  @ApiProperty({ type: CountryDto })
  country: CountryDto;
}

export class SupportIssueInternalWalletDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  amlRules: string;

  @ApiProperty()
  isKycClient: boolean;
}

export class SupportIssueInternalTransactionDataDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: TransactionSourceType })
  sourceType: TransactionSourceType;

  @ApiProperty({ enum: TransactionTypeInternal })
  type: TransactionTypeInternal;

  @ApiProperty({ enum: CheckStatus })
  amlCheck: CheckStatus;

  @ApiProperty({ enum: AmlReason })
  amlReason: AmlReason;

  @ApiProperty()
  comment: string;

  @ApiProperty()
  inputAmount: number;

  @ApiProperty()
  inputAsset: string;

  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiProperty()
  outputAmount: number;

  @ApiProperty()
  outputAsset: string;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;

  @ApiProperty({ type: SupportIssueInternalWalletDto })
  wallet: SupportIssueInternalWalletDto;

export class SupportIssueInternalLimitRequestDataDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  limit: number;

  @ApiPropertyOptional()
  acceptedLimit?: number;

  @ApiProperty()
  investmentDate: InvestmentDate;

  @ApiProperty()
  fundOrigin: FundOrigin;

  @ApiPropertyOptional()
  decision?: LimitRequestDecision;
}

export class SupportIssueInternalDataDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: Date })
  created: Date;

  @ApiProperty()
  uid: string;

  @ApiProperty({ enum: SupportIssueType })
  type: SupportIssueType;

  @ApiProperty({ enum: Department })
  department?: Department;

  @ApiProperty({ enum: SupportIssueReason })
  reason: SupportIssueReason;

  @ApiProperty({ enum: SupportIssueInternalState })
  state: SupportIssueInternalState;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: SupportIssueInternalAccountDataDto })
  account: SupportIssueInternalAccountDataDto;

  @ApiProperty({ type: SupportIssueInternalTransactionDataDto })
  transaction: SupportIssueInternalTransactionDataDto;

  @ApiPropertyOptional({ type: SupportIssueInternalLimitRequestDataDto })
  limitRequest?: SupportIssueInternalLimitRequestDataDto;
}

export const SupportIssueStateMapper: {
  [key in SupportIssueInternalState]: SupportIssueState;
} = {
  [SupportIssueInternalState.CREATED]: SupportIssueState.PENDING,
  [SupportIssueInternalState.PENDING]: SupportIssueState.PENDING,
  [SupportIssueInternalState.COMPLETED]: SupportIssueState.COMPLETED,
  [SupportIssueInternalState.CANCELED]: SupportIssueState.CANCELED,
  [SupportIssueInternalState.ON_HOLD]: SupportIssueState.PENDING,
};
