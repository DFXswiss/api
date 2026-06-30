import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CountryDto } from 'src/shared/models/country/dto/country.dto';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';
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
  SEPA_STANDARD = 'support-issue.sepa_standard',
  SEPA_WEEKEND = 'support-issue.sepa_weekend',
  MISSING_LIQUIDITY = 'support-issue.missing_liquidity',
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

  @ApiPropertyOptional()
  verifiedName?: string;

  @ApiPropertyOptional()
  completeName?: string;

  @ApiPropertyOptional({ enum: AccountType })
  accountType?: AccountType;

  @ApiProperty({ enum: KycLevel })
  kycLevel: KycLevel;

  @ApiPropertyOptional()
  depositLimit?: number;

  @ApiProperty()
  annualVolume: number;

  @ApiProperty()
  kycHash: string;

  @ApiPropertyOptional({ type: CountryDto })
  country?: CountryDto;

  @ApiPropertyOptional({ type: LanguageDto })
  language?: LanguageDto;
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

  @ApiPropertyOptional({ enum: CheckStatus })
  amlCheck?: CheckStatus;

  @ApiPropertyOptional({ enum: AmlReason })
  amlReason?: AmlReason;

  @ApiPropertyOptional()
  comment?: string;

  @ApiPropertyOptional()
  inputAmount?: number;

  @ApiPropertyOptional()
  inputAsset?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;

  @ApiPropertyOptional({ type: SupportIssueInternalWalletDto })
  wallet?: SupportIssueInternalWalletDto;

  @ApiPropertyOptional()
  isComplete?: boolean;
}

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

export class SupportIssueInternalTransactionMissingDataDto {
  @ApiPropertyOptional()
  senderIban?: string;

  @ApiPropertyOptional()
  receiverIban?: string;

  @ApiPropertyOptional()
  date?: string;
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

  @ApiPropertyOptional({ enum: Department })
  department?: Department;

  @ApiProperty({ enum: SupportIssueReason })
  reason: SupportIssueReason;

  @ApiProperty({ enum: SupportIssueInternalState })
  state: SupportIssueInternalState;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  clerk?: string;

  @ApiProperty({ type: SupportIssueInternalAccountDataDto })
  account: SupportIssueInternalAccountDataDto;

  @ApiPropertyOptional({ type: SupportIssueInternalTransactionDataDto })
  transaction?: SupportIssueInternalTransactionDataDto;

  @ApiPropertyOptional({ type: SupportIssueInternalLimitRequestDataDto })
  limitRequest?: SupportIssueInternalLimitRequestDataDto;

  @ApiPropertyOptional({ type: SupportIssueInternalTransactionMissingDataDto })
  transactionMissing?: SupportIssueInternalTransactionMissingDataDto;
}

export class SupportIssueListDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  uid: string;

  @ApiProperty({ enum: SupportIssueType })
  type: SupportIssueType;

  @ApiProperty({ enum: SupportIssueReason })
  reason: SupportIssueReason;

  @ApiProperty({ enum: SupportIssueInternalState })
  state: SupportIssueInternalState;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  clerk?: string;

  @ApiPropertyOptional({ enum: Department })
  department?: Department;

  @ApiProperty({ type: Date })
  created: Date;

  @ApiProperty({ type: Date })
  updated: Date;

  @ApiProperty()
  messageCount: number;

  @ApiPropertyOptional({ type: Date })
  lastMessageDate?: Date;

  @ApiPropertyOptional()
  lastMessageAuthor?: string;
}

export class SupportIssueStatisticsBucketDto {
  @ApiProperty({ description: 'Bucket key: "YYYY-MM-DD" (daily) or "YYYY-MM" (monthly)' })
  key: string;

  @ApiProperty()
  count: number;
}

export class SupportIssueStatisticsResolutionDto {
  @ApiProperty({ description: 'Issue type' })
  key: string;

  @ApiProperty({ description: 'Average hours from creation to completion' })
  avgHours: number;

  @ApiProperty({ description: 'Number of completed tickets in the period' })
  count: number;
}

export class SupportIssueStatisticsDto {
  @ApiProperty({ description: 'Analysis period in days' })
  periodDays: number;

  @ApiProperty({ description: 'Tickets created within the period' })
  total: number;

  @ApiProperty({ description: 'Average number of messages per ticket within the period' })
  avgMessages: number;

  @ApiProperty({ description: 'Average tickets per day within the period' })
  perDay: number;

  @ApiProperty({ enum: ['day', 'month'], description: 'Trend bucket granularity' })
  granularity: 'day' | 'month';

  @ApiProperty({
    type: [SupportIssueStatisticsBucketDto],
    description: 'Trend buckets across the period, oldest first',
  })
  trend: SupportIssueStatisticsBucketDto[];

  @ApiProperty({ description: 'Average hours from creation to completion (tickets completed in the period)' })
  avgResolutionHours: number;

  @ApiProperty({
    type: [SupportIssueStatisticsResolutionDto],
    description: 'Average resolution time per type, descending by count',
  })
  resolutionByType: SupportIssueStatisticsResolutionDto[];
}

export const SupportIssueStateMapper: {
  [key in SupportIssueInternalState]: SupportIssueState;
} = {
  [SupportIssueInternalState.CREATED]: SupportIssueState.PENDING,
  [SupportIssueInternalState.PENDING]: SupportIssueState.PENDING,
  [SupportIssueInternalState.IN_PROGRESS]: SupportIssueState.IN_PROGRESS,
  [SupportIssueInternalState.IN_CLARIFICATION]: SupportIssueState.IN_CLARIFICATION,
  [SupportIssueInternalState.COMPLETED]: SupportIssueState.COMPLETED,
  [SupportIssueInternalState.CANCELED]: SupportIssueState.CANCELED,
  [SupportIssueInternalState.ON_HOLD]: SupportIssueState.PENDING,
};
