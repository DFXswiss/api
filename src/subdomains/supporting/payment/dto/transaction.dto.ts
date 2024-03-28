import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
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
  KYC_REQUIRED = 'KycRequired',
  FEE_TOO_HIGH = 'FeeTooHigh',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  RETURNED = 'Returned',
}

export enum TransactionReason {
  UNKNOWN = 'Unknown',
  DAILY_LIMIT_EXCEEDED = 'DailyLimitExceeded',
  ANNUAL_LIMIT_EXCEEDED = 'AnnualLimitExceeded',
  ACCOUNT_HOLDER_MISMATCH = 'AccountHolderMismatch',
  KYC_REJECTED = 'KycRejected',
  FRAUD_SUSPICION = 'FraudSuspicion',
  SANCTION_SUSPICION = 'SanctionSuspicion',
  MIN_DEPOSIT_NOT_REACHED = 'MinDepositNotReached',
  ASSET_NOT_AVAILABLE = 'AssetNotAvailable',
  STAKING_DISCONTINUED = 'StakingDiscontinued',
  BANK_NOT_ALLOWED = 'BankNotAllowed',
  PAYMENT_ACCOUNT_NOT_ALLOWED = 'PaymentAccountNotAllowed',
  COUNTRY_NOT_ALLOWED = 'CountryNotAllowed',
  INSTANT_PAYMENT = 'InstantPayment',
}

export const KycRequiredReason = [
  TransactionReason.DAILY_LIMIT_EXCEEDED,
  TransactionReason.ANNUAL_LIMIT_EXCEEDED,
  TransactionReason.INSTANT_PAYMENT,
  TransactionReason.SANCTION_SUSPICION,
  TransactionReason.FRAUD_SUSPICION,
];

export const TransactionReasonMapper: {
  [key in AmlReason]: TransactionReason;
} = {
  [AmlReason.NA]: null,
  [AmlReason.MANUAL_CHECK]: null,
  [AmlReason.NO_COMMUNICATION]: TransactionReason.UNKNOWN,
  [AmlReason.IBAN_CHECK]: TransactionReason.UNKNOWN,
  [AmlReason.DAILY_LIMIT]: TransactionReason.DAILY_LIMIT_EXCEEDED,
  [AmlReason.ANNUAL_LIMIT]: TransactionReason.ANNUAL_LIMIT_EXCEEDED,
  [AmlReason.ANNUAL_LIMIT_WITHOUT_KYC]: TransactionReason.ANNUAL_LIMIT_EXCEEDED,
  [AmlReason.USER_DATA_MISMATCH]: TransactionReason.ACCOUNT_HOLDER_MISMATCH,
  [AmlReason.KYC_REJECTED]: TransactionReason.KYC_REJECTED,
  [AmlReason.OLKY_NO_KYC]: TransactionReason.INSTANT_PAYMENT,
  [AmlReason.NAME_CHECK_WITHOUT_KYC]: TransactionReason.SANCTION_SUSPICION,
  [AmlReason.HIGH_RISK_KYC_NEEDED]: TransactionReason.FRAUD_SUSPICION,
  [AmlReason.MIN_DEPOSIT_NOT_REACHED]: TransactionReason.MIN_DEPOSIT_NOT_REACHED,
  [AmlReason.ASSET_CURRENTLY_NOT_AVAILABLE]: TransactionReason.ASSET_NOT_AVAILABLE,
  [AmlReason.STAKING_DISCONTINUED]: TransactionReason.STAKING_DISCONTINUED,
  [AmlReason.BANK_NOT_ALLOWED]: TransactionReason.BANK_NOT_ALLOWED,
  [AmlReason.HIGH_RISK_BLOCKED]: TransactionReason.PAYMENT_ACCOUNT_NOT_ALLOWED,
  [AmlReason.COUNTRY_NOT_ALLOWED]: TransactionReason.COUNTRY_NOT_ALLOWED,
};

export class UnassignedTransactionDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

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

  @ApiPropertyOptional()
  inputTxId?: string;

  @ApiPropertyOptional()
  inputTxUrl?: string;

  @ApiProperty({ type: Date })
  date: Date;
}

export class TransactionDto extends UnassignedTransactionDto {
  @ApiProperty({ enum: TransactionState })
  state: TransactionState;

  @ApiPropertyOptional({ enum: TransactionReason })
  reason?: TransactionReason;

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

  @ApiPropertyOptional()
  outputTxId?: string;

  @ApiPropertyOptional()
  outputTxUrl?: string;

  @ApiPropertyOptional({ description: 'Fee amount in input asset' })
  feeAmount?: number;

  @ApiPropertyOptional({ deprecated: true })
  feeAsset?: string;

  @ApiPropertyOptional()
  externalTransactionId?: string;
}

export class TransactionDetailDto extends TransactionDto {
  @ApiPropertyOptional()
  sourceAccount: string;

  @ApiPropertyOptional()
  targetAccount: string;
}
