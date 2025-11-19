import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
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
