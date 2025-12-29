import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { HistoryEventType, HolderClientResponse, PageInfo } from './client.dto';

export class HistoricalBalanceDto {
  @ApiProperty({ description: 'Token balance at this point in time' })
  balance: string;

  @ApiProperty({ description: 'Timestamp when this balance was recorded' })
  timestamp: Date;

  @ApiPropertyOptional({ description: 'Valuation in CHF at this point in time' })
  valueChf?: number;
}

export class PageInfoDto implements PageInfo {
  @ApiProperty({ description: 'Cursor pointing to the end of the current page' })
  endCursor: string;

  @ApiProperty({ description: 'Whether there is a next page available' })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page available' })
  hasPreviousPage: boolean;

  @ApiProperty({ description: 'Cursor pointing to the start of the current page' })
  startCursor: string;
}

export class ChangeTotalSharesDto {
  @ApiProperty({ description: 'Total shares amount' })
  total: string;

  @ApiProperty({ description: 'Timestamp of the change' })
  timestamp: Date;

  @ApiProperty({ description: 'Transaction hash of the change' })
  txHash: string;
}

export class TotalSupplyDto {
  @ApiProperty({ description: 'Total supply value' })
  value: string;

  @ApiProperty({ description: 'Timestamp when this supply was recorded' })
  timestamp: Date;
}

export class TransferDto {
  @ApiProperty({ description: 'Address sending the tokens' })
  from: string;

  @ApiProperty({ description: 'Address receiving the tokens' })
  to: string;

  @ApiProperty({ description: 'Amount of tokens transferred' })
  value: string;
}

export class ApprovalDto {
  @ApiProperty({ description: 'Address approved to spend tokens' })
  spender: string;

  @ApiProperty({ description: 'Amount of tokens approved' })
  value: string;
}

export class TokensDeclaredInvalidDto {
  @ApiProperty({ description: 'Amount of tokens declared invalid' })
  amount: string;

  @ApiProperty({ description: 'Reason for invalidation' })
  message: string;
}

export class AddressTypeUpdateDto {
  @ApiProperty({ description: 'New address type' })
  addressType: string;
}

export class HistoryEventDto {
  @ApiProperty({ description: 'Timestamp of the event' })
  timestamp: Date;

  @ApiProperty({ enum: HistoryEventType, description: 'Type of event' })
  eventType: HistoryEventType;

  @ApiProperty({ description: 'Transaction hash of the event' })
  txHash: string;

  @ApiPropertyOptional({ type: AddressTypeUpdateDto, description: 'Address type update details' })
  addressTypeUpdate?: AddressTypeUpdateDto;

  @ApiPropertyOptional({ type: ApprovalDto, description: 'Approval event details' })
  approval?: ApprovalDto;

  @ApiPropertyOptional({ type: TokensDeclaredInvalidDto, description: 'Invalid tokens declaration details' })
  tokensDeclaredInvalid?: TokensDeclaredInvalidDto;

  @ApiPropertyOptional({ type: TransferDto, description: 'Transfer event details' })
  transfer?: TransferDto;
}

export class AccountSummaryDto {
  @ApiProperty({ description: 'Account address' })
  address: string;

  @ApiProperty({ description: 'Type of address (e.g., EOA, contract)' })
  addressType: string;

  @ApiProperty({ description: 'Current balance of the account' })
  balance: string;

  @ApiProperty({ description: 'Timestamp of last balance update' })
  lastUpdated: Date;

  @ApiProperty({ type: [HistoricalBalanceDto], description: 'Historical balance data over time' })
  historicalBalances: HistoricalBalanceDto[];
}

export class HolderDto implements HolderClientResponse {
  @ApiProperty({ description: 'Holder address' })
  address: string;

  @ApiProperty({ description: 'Token balance held by this address' })
  balance: string;

  @ApiProperty({ description: 'Percentage of total supply held by this address' })
  percentage: number;
}

export class TokenInfoDto {
  @ApiProperty({ type: ChangeTotalSharesDto, description: 'Latest change in total shares information' })
  totalShares: ChangeTotalSharesDto;

  @ApiProperty({ type: TotalSupplyDto, description: 'Current total supply information' })
  totalSupply: TotalSupplyDto;
}

export class HoldersDto {
  @ApiProperty({ type: [HolderDto], description: 'List of token holders' })
  holders: HolderDto[];

  @ApiProperty({ type: PageInfoDto, description: 'Pagination information for navigating through results' })
  pageInfo: PageInfoDto;

  @ApiProperty({ description: 'Total number of holders' })
  totalCount: number;
}

export class AccountHistoryDto {
  @ApiProperty({ description: 'Account address' })
  address: string;

  @ApiProperty({ description: 'Type of address (e.g., EOA, contract)' })
  addressType: string;

  @ApiProperty({ type: [HistoryEventDto], description: 'List of historical events for this account' })
  history: HistoryEventDto[];

  @ApiProperty({ description: 'Total number of historical events' })
  totalCount: number;

  @ApiProperty({ type: PageInfoDto, description: 'Pagination information for navigating through results' })
  pageInfo: PageInfoDto;
}

export class RealUnitPriceDto {
  @ApiProperty({ description: 'Current price of RealUnit in CHF' })
  chf: number;
}

export enum TimeFrame {
  WEEK = '1W',
  MONTH = '1M',
  QUARTER = '1Q',
  YEAR = '1Y',
  ALL = 'ALL',
}

export class AccountHistoryQueryDto {
  @ApiPropertyOptional({ type: Number, description: 'Number of history events to return (default: 50)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  first?: number;

  @ApiPropertyOptional({ type: String, description: 'Cursor for pagination - return events after this cursor' })
  @IsOptional()
  @IsString()
  after?: string;
}

export class HoldersQueryDto {
  @ApiPropertyOptional({ type: Number, description: 'Number of holders to return (default: 50)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  first?: number;

  @ApiPropertyOptional({
    type: String,
    description:
      'Cursor for pagination - return holders before this cursor, cursor is the startCursor of the previous page',
  })
  @IsOptional()
  @IsString()
  before?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Cursor for pagination - return holders after this cursor, cursor is the endCursor of the previous page',
  })
  @IsOptional()
  @IsString()
  after?: string;
}

export class HistoricalPriceQueryDto {
  @ApiPropertyOptional({ enum: TimeFrame, description: 'Time frame for historical prices (default: WEEK)' })
  @IsOptional()
  @IsEnum(TimeFrame)
  timeFrame?: TimeFrame;
}

export class HistoricalPriceDto {
  @ApiProperty({ description: 'Timestamp when the price was recorded' })
  timestamp: Date;

  @ApiProperty({ description: 'Price in CHF' })
  chf: number;

  @ApiProperty({ description: 'Price in EUR' })
  eur?: number;

  @ApiProperty({ description: 'Price in USD' })
  usd?: number;
}

export class BankDetailsDto {
  @ApiProperty({ description: 'Bank account recipient name' })
  recipient: string;

  @ApiProperty({ description: 'Recipient address' })
  address: string;

  @ApiProperty({ description: 'IBAN' })
  iban: string;

  @ApiProperty({ description: 'BIC/SWIFT code' })
  bic: string;

  @ApiProperty({ description: 'Bank name' })
  bankName: string;

  @ApiProperty({ description: 'Currency (always CHF)' })
  currency: string;
}

// --- Buy Payment Info DTOs ---

export enum RealUnitBuyCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
}

export class RealUnitBuyDto {
  @ApiProperty({ description: 'Amount in fiat currency' })
  @IsNumber()
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({
    enum: RealUnitBuyCurrency,
    description: 'Currency (CHF or EUR)',
    default: RealUnitBuyCurrency.CHF,
  })
  @IsOptional()
  @IsEnum(RealUnitBuyCurrency)
  currency?: RealUnitBuyCurrency;
}

export class RealUnitPaymentInfoDto {
  @ApiProperty({ description: 'Transaction request ID' })
  id: number;

  @ApiProperty({ description: 'Route ID' })
  routeId: number;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  // Bank info
  @ApiProperty({ description: 'Personal IBAN for this asset' })
  iban: string;

  @ApiProperty({ description: 'BIC/SWIFT code' })
  bic: string;

  @ApiProperty({ description: 'Recipient name' })
  name: string;

  @ApiProperty({ description: 'Recipient street' })
  street: string;

  @ApiProperty({ description: 'Recipient house number' })
  number: string;

  @ApiProperty({ description: 'Recipient zip code' })
  zip: string;

  @ApiProperty({ description: 'Recipient city' })
  city: string;

  @ApiProperty({ description: 'Recipient country' })
  country: string;

  // Amount info
  @ApiProperty({ description: 'Amount to transfer' })
  amount: number;

  @ApiProperty({ description: 'Currency' })
  currency: string;

  // Fee info
  @ApiProperty({ type: FeeDto, description: 'Fee infos in source currency' })
  fees: FeeDto;

  @ApiProperty({ description: 'Minimum volume in source currency' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in source currency' })
  maxVolume: number;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target asset' })
  maxVolumeTarget: number;

  // Rate info
  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  // RealUnit specific
  @ApiProperty({ description: 'Estimated REALU shares to receive' })
  estimatedAmount: number;

  @ApiPropertyOptional({ description: 'QR code for payment (Swiss QR-bill or GiroCode)' })
  paymentRequest?: string;

  @ApiProperty()
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;
}
