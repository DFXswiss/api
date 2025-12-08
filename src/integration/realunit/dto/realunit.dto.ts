import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
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

// --- Brokerbot DTOs ---

export class BrokerbotPriceDto {
  @ApiProperty({ description: 'Current price per share in CHF (18 decimals formatted)' })
  pricePerShare: string;

  @ApiProperty({ description: 'Raw price per share in wei' })
  pricePerShareRaw: string;
}

export class BrokerbotBuyPriceDto {
  @ApiProperty({ description: 'Number of shares' })
  shares: number;

  @ApiProperty({ description: 'Total cost in CHF (18 decimals formatted)' })
  totalPrice: string;

  @ApiProperty({ description: 'Raw total cost in wei' })
  totalPriceRaw: string;

  @ApiProperty({ description: 'Price per share in CHF' })
  pricePerShare: string;
}

export class BrokerbotSellPriceDto {
  @ApiProperty({ description: 'Number of shares to sell' })
  shares: number;

  @ApiProperty({ description: 'Total proceeds in CHF (18 decimals formatted)' })
  totalProceeds: string;

  @ApiProperty({ description: 'Raw total proceeds in wei' })
  totalProceedsRaw: string;

  @ApiProperty({ description: 'Current price per share in CHF' })
  pricePerShare: string;
}

export class BrokerbotSharesDto {
  @ApiProperty({ description: 'Amount in CHF' })
  amount: string;

  @ApiProperty({ description: 'Number of shares that can be purchased' })
  shares: number;

  @ApiProperty({ description: 'Price per share in CHF' })
  pricePerShare: string;
}

export class AllowlistStatusDto {
  @ApiProperty({ description: 'Wallet address' })
  address: string;

  @ApiProperty({ description: 'Whether the address can receive REALU tokens' })
  canReceive: boolean;

  @ApiProperty({ description: 'Whether the address is forbidden' })
  isForbidden: boolean;

  @ApiProperty({ description: 'Whether the address is powerlisted (can send to anyone)' })
  isPowerlisted: boolean;
}

export class BrokerbotInfoDto {
  @ApiProperty({ description: 'Brokerbot contract address' })
  brokerbotAddress: string;

  @ApiProperty({ description: 'REALU token address' })
  tokenAddress: string;

  @ApiProperty({ description: 'Base currency (ZCHF) address' })
  baseCurrencyAddress: string;

  @ApiProperty({ description: 'Current price per share in CHF' })
  pricePerShare: string;

  @ApiProperty({ description: 'Whether buying is enabled' })
  buyingEnabled: boolean;

  @ApiProperty({ description: 'Whether selling is enabled' })
  sellingEnabled: boolean;
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

// --- Brokerbot Sell DTOs ---

export class BrokerbotSellRequest {
  @ApiProperty({ description: 'Number of shares to sell' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  shares: number;

  @ApiProperty({ description: 'Wallet address of the seller' })
  @IsNotEmpty()
  @IsString()
  walletAddress: string;

  @ApiPropertyOptional({ description: 'Minimum acceptable price (slippage protection)' })
  @IsOptional()
  @IsString()
  minPrice?: string;
}

export class BrokerbotSellTxDto {
  @ApiProperty({ description: 'Target contract address (REALU token)' })
  to: string;

  @ApiProperty({ description: 'Encoded transferAndCall() function data' })
  data: string;

  @ApiProperty({ description: 'ETH value (always "0")' })
  value: string;

  @ApiProperty({ description: 'Estimated gas limit' })
  gasLimit: string;

  @ApiProperty({ description: 'Chain ID (1 for Ethereum mainnet)' })
  chainId: number;

  @ApiProperty({ description: 'Number of shares being sold' })
  expectedShares: number;

  @ApiProperty({ description: 'Expected ZCHF proceeds' })
  expectedPrice: string;

  @ApiProperty({ description: 'TX data validity expiration (ISO timestamp)' })
  expiresAt: string;
}

export class BrokerbotBroadcastRequest {
  @ApiProperty({ description: 'Hex-encoded signed transaction' })
  @IsNotEmpty()
  @IsString()
  signedTransaction: string;
}

export class BrokerbotBroadcastResponse {
  @ApiProperty({ description: 'Transaction hash' })
  txHash: string;

  @ApiProperty({ description: 'Number of shares sold' })
  shares: number;

  @ApiProperty({ description: 'ZCHF received from Brokerbot' })
  zchfReceived: string;
}

// --- Permit2 Approval DTOs ---

export class Permit2ApprovalDto {
  @ApiProperty({ description: 'Wallet address' })
  address: string;

  @ApiProperty({ description: 'Spender address (Permit2 contract)' })
  spender: string;

  @ApiProperty({ description: 'Current allowance amount' })
  allowance: string;

  @ApiProperty({ description: 'Whether any approval exists' })
  isApproved: boolean;

  @ApiProperty({ description: 'Whether approval is unlimited (MaxUint256)' })
  isUnlimited: boolean;
}

export class Permit2ApproveRequest {
  @ApiProperty({ description: 'Wallet address' })
  @IsNotEmpty()
  @IsString()
  walletAddress: string;

  @ApiPropertyOptional({ description: 'Set to true for unlimited approval (default: true)' })
  @IsOptional()
  unlimited?: boolean;
}

export class Permit2ApproveTxDto {
  @ApiProperty({ description: 'Target contract address (ZCHF token)' })
  to: string;

  @ApiProperty({ description: 'Encoded approve() function data' })
  data: string;

  @ApiProperty({ description: 'ETH value (always "0")' })
  value: string;

  @ApiProperty({ description: 'Estimated gas limit' })
  gasLimit: string;

  @ApiProperty({ description: 'Chain ID (1 for Ethereum mainnet)' })
  chainId: number;

  @ApiProperty({ description: 'Approval amount for display' })
  approvalAmount: string;
}

// --- Atomic Sell DTOs ---

export class RealUnitPermitDto {
  @ApiProperty({ description: 'Permit2 signature' })
  @IsNotEmpty()
  @IsString()
  signature: string;

  @ApiProperty({ description: 'Permitted ZCHF amount in wei' })
  @IsNotEmpty()
  @IsString()
  amount: string;

  @ApiProperty({ description: 'Permit2 nonce' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  nonce: number;

  @ApiProperty({ description: 'Permit2 deadline (unix timestamp)' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  deadline: number;
}

export class RealUnitAtomicSellRequest {
  @ApiProperty({ description: 'Hex-encoded signed Brokerbot transaction (REALU → ZCHF)' })
  @IsNotEmpty()
  @IsString()
  signedBrokerbotTx: string;

  @ApiProperty({ type: RealUnitPermitDto, description: 'Permit2 signature data for ZCHF transfer' })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => RealUnitPermitDto)
  permit: RealUnitPermitDto;
}

export class RealUnitAtomicSellResponse {
  @ApiProperty({ description: 'Brokerbot transaction hash' })
  brokerbotTxHash: string;

  @ApiProperty({ description: 'Permit2 transfer transaction hash' })
  permitTxHash: string;

  @ApiProperty({ description: 'Number of REALU shares sold' })
  shares: number;

  @ApiProperty({ description: 'ZCHF received from Brokerbot' })
  zchfReceived: string;

  @ApiProperty({ description: 'ZCHF transferred to DFX via Permit2' })
  zchfTransferred: string;
}
