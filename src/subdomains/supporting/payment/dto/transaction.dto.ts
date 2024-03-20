import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlReason } from 'src/subdomains/core/buy-crypto/process/enums/aml-reason.enum';
import { PaymentMethod, PaymentMethodSwagger } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

export enum TransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CONVERT = 'Convert',
  REFERRAL = 'Referral',
}

export enum TransactionState {
  CREATED = 'Created',
  PROCESSING = 'Processing',
  AML_PENDING = 'AmlPending',
  FEE_TOO_HIGH = 'FeeTooHigh',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  RETURNED = 'Returned',
}

export enum TransactionError {
  NA = 'NA',
  DAILY_LIMIT_EXCEEDED = 'DailyLimitExceeded',
  ANNUAL_LIMIT_EXCEEDED = 'AnnualLimitExceeded',
  BANK_ACCOUNT_NOT_MATCHING = 'BankAccountNotMatching',
  IBAN_CHECK = 'IbanCheck',
  KYC_REJECTED = 'KycRejected',
  KYC_MISSING = 'KycMissing',
  MIN_DEPOSIT_NOT_REACHED = 'MinDepositNotReached',
  ASSET_NOT_AVAILABLE = 'AssetNotAvailable',
  STAKING_DISCONTINUED = 'StakingDiscontinued',
  BANK_NOT_ALLOWED = 'BankNotAllowed',
  COUNTRY_NOT_ALLOWED = 'CountryNotAllowed',
  MANUAL_CHECK = 'ManualCheck',
}

export const TransactionErrorMapper: {
  [key in AmlReason]: TransactionError;
} = {
  [AmlReason.NA]: TransactionError.NA,
  [AmlReason.DAILY_LIMIT]: TransactionError.DAILY_LIMIT_EXCEEDED,
  [AmlReason.ANNUAL_LIMIT]: TransactionError.ANNUAL_LIMIT_EXCEEDED,
  [AmlReason.ANNUAL_LIMIT_WITHOUT_KYC]: TransactionError.ANNUAL_LIMIT_EXCEEDED,
  [AmlReason.USER_DATA_MISMATCH]: TransactionError.BANK_ACCOUNT_NOT_MATCHING,
  [AmlReason.IBAN_CHECK]: TransactionError.IBAN_CHECK,
  [AmlReason.KYC_REJECTED]: TransactionError.KYC_REJECTED,
  [AmlReason.OLKY_NO_KYC]: TransactionError.KYC_MISSING,
  [AmlReason.NAME_CHECK_WITHOUT_KYC]: TransactionError.KYC_MISSING,
  [AmlReason.HIGH_RISK_KYC_NEEDED]: TransactionError.KYC_MISSING,
  [AmlReason.MIN_DEPOSIT_NOT_REACHED]: TransactionError.MIN_DEPOSIT_NOT_REACHED,
  [AmlReason.ASSET_CURRENTLY_NOT_AVAILABLE]: TransactionError.ASSET_NOT_AVAILABLE,
  [AmlReason.STAKING_DISCONTINUED]: TransactionError.STAKING_DISCONTINUED,
  [AmlReason.BANK_NOT_ALLOWED]: TransactionError.BANK_NOT_ALLOWED,
  [AmlReason.HIGH_RISK_BLOCKED]: TransactionError.BANK_NOT_ALLOWED,
  [AmlReason.COUNTRY_NOT_ALLOWED]: TransactionError.COUNTRY_NOT_ALLOWED,
  [AmlReason.MANUAL_CHECK]: TransactionError.MANUAL_CHECK,
};

export class TransactionDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ enum: TransactionState })
  state: TransactionState;

  @ApiProperty({ enum: TransactionError })
  error: TransactionError;

  @ApiPropertyOptional()
  inputAmount?: number;

  @ApiPropertyOptional()
  inputAsset?: string;

  @ApiPropertyOptional({ description: 'Fiat ID for buy transactions, asset ID otherwise' })
  inputAssetId?: number;

  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiPropertyOptional({ enum: PaymentMethodSwagger })
  inputPaymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Exchange rate in input/output' })
  exchangeRate?: number;

  @ApiPropertyOptional({ description: 'Final rate (incl. fees) in input/output' })
  rate?: number;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;

  @ApiPropertyOptional({ description: 'Fiat ID for sell transactions, asset ID otherwise' })
  outputAssetId?: number;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;

  @ApiPropertyOptional({ enum: PaymentMethodSwagger })
  outputPaymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Fee amount in input asset' })
  feeAmount?: number;

  @ApiPropertyOptional({ deprecated: true })
  feeAsset?: string;

  @ApiPropertyOptional()
  inputTxId?: string;

  @ApiPropertyOptional()
  inputTxUrl?: string;

  @ApiPropertyOptional()
  outputTxId?: string;

  @ApiPropertyOptional()
  outputTxUrl?: string;

  @ApiProperty({ type: Date })
  date: Date;

  @ApiPropertyOptional()
  externalTransactionId?: string;
}
