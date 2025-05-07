import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { PaymentMethod, PaymentMethodSwagger } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { PriceStep } from '../../pricing/domain/entities/price';
import { FeeDto } from './fee.dto';

export enum TransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  SWAP = 'Swap',
  REFERRAL = 'Referral',
}

export enum TransactionState {
  CREATED = 'Created',
  PROCESSING = 'Processing',
  LIQUIDITY_PENDING = 'LiquidityPending',
  AML_PENDING = 'AmlPending',
  KYC_REQUIRED = 'KycRequired',
  LIMIT_EXCEEDED = 'LimitExceeded',
  FEE_TOO_HIGH = 'FeeTooHigh',
  PRICE_UNDETERMINABLE = 'PriceUndeterminable',
  PAYOUT_IN_PROGRESS = 'PayoutInProgress',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  RETURN_PENDING = 'ReturnPending',
  RETURNED = 'Returned',
  UNASSIGNED = 'Unassigned',
}

export enum TransactionReason {
  UNKNOWN = 'Unknown',
  MONTHLY_LIMIT_EXCEEDED = 'MonthlyLimitExceeded',
  ANNUAL_LIMIT_EXCEEDED = 'AnnualLimitExceeded',
  ACCOUNT_HOLDER_MISMATCH = 'AccountHolderMismatch',
  KYC_REJECTED = 'KycRejected',
  FRAUD_SUSPICION = 'FraudSuspicion',
  SANCTION_SUSPICION = 'SanctionSuspicion',
  MIN_DEPOSIT_NOT_REACHED = 'MinDepositNotReached',
  ASSET_NOT_AVAILABLE = 'AssetNotAvailable',
  ASSET_NOT_AVAILABLE_WITH_CHOSEN_BANK = 'AssetNotAvailableWithChosenBank',
  STAKING_DISCONTINUED = 'StakingDiscontinued',
  BANK_NOT_ALLOWED = 'BankNotAllowed',
  PAYMENT_ACCOUNT_NOT_ALLOWED = 'PaymentAccountNotAllowed',
  COUNTRY_NOT_ALLOWED = 'CountryNotAllowed',
  INSTANT_PAYMENT = 'InstantPayment',
  FEE_TOO_HIGH = 'FeeTooHigh',
  RECEIVER_REJECTED = 'ReceiverRejected',
  CHF_ABROAD_NOT_ALLOWED = 'ChfAbroadNotAllowed',
  ASSET_KYC_NEEDED = 'AssetKycNeeded',
  CARD_NAME_MISMATCH = 'CardNameMismatch',
  USER_DELETED = 'UserDeleted',
  VIDEO_IDENT_NEEDED = 'VideoIdentNeeded',
  MISSING_LIQUIDITY = 'MissingLiquidity',
  KYC_DATA_NEEDED = 'KycDataNeeded',
}

export const KycRequiredReason = [
  TransactionReason.INSTANT_PAYMENT,
  TransactionReason.SANCTION_SUSPICION,
  TransactionReason.FRAUD_SUSPICION,
];

export const LimitExceededReason = [TransactionReason.MONTHLY_LIMIT_EXCEEDED, TransactionReason.ANNUAL_LIMIT_EXCEEDED];

export const TransactionReasonMapper: {
  [key in AmlReason]: TransactionReason;
} = {
  [AmlReason.NA]: null,
  [AmlReason.MANUAL_CHECK]: null,
  [AmlReason.NO_COMMUNICATION]: TransactionReason.UNKNOWN,
  [AmlReason.USER_BLOCKED]: TransactionReason.UNKNOWN,
  [AmlReason.USER_DATA_BLOCKED]: TransactionReason.UNKNOWN,
  [AmlReason.USER_DELETED]: TransactionReason.USER_DELETED,
  [AmlReason.MONTHLY_LIMIT]: TransactionReason.MONTHLY_LIMIT_EXCEEDED,
  [AmlReason.ANNUAL_LIMIT]: TransactionReason.ANNUAL_LIMIT_EXCEEDED,
  [AmlReason.ANNUAL_LIMIT_WITHOUT_KYC]: TransactionReason.ANNUAL_LIMIT_EXCEEDED,
  [AmlReason.USER_DATA_MISMATCH]: TransactionReason.ACCOUNT_HOLDER_MISMATCH,
  [AmlReason.IBAN_CHECK]: TransactionReason.ACCOUNT_HOLDER_MISMATCH,
  [AmlReason.KYC_REJECTED]: TransactionReason.KYC_REJECTED,
  [AmlReason.OLKY_NO_KYC]: TransactionReason.INSTANT_PAYMENT,
  [AmlReason.NAME_CHECK_WITHOUT_KYC]: TransactionReason.SANCTION_SUSPICION,
  [AmlReason.HIGH_RISK_KYC_NEEDED]: TransactionReason.FRAUD_SUSPICION,
  [AmlReason.MIN_DEPOSIT_NOT_REACHED]: TransactionReason.MIN_DEPOSIT_NOT_REACHED,
  [AmlReason.ASSET_CURRENTLY_NOT_AVAILABLE]: TransactionReason.ASSET_NOT_AVAILABLE,
  [AmlReason.ASSET_NOT_AVAILABLE_WITH_CHOSEN_BANK]: TransactionReason.ASSET_NOT_AVAILABLE_WITH_CHOSEN_BANK,
  [AmlReason.STAKING_DISCONTINUED]: TransactionReason.STAKING_DISCONTINUED,
  [AmlReason.BANK_NOT_ALLOWED]: TransactionReason.BANK_NOT_ALLOWED,
  [AmlReason.HIGH_RISK_BLOCKED]: TransactionReason.PAYMENT_ACCOUNT_NOT_ALLOWED,
  [AmlReason.COUNTRY_NOT_ALLOWED]: TransactionReason.COUNTRY_NOT_ALLOWED,
  [AmlReason.FEE_TOO_HIGH]: TransactionReason.FEE_TOO_HIGH,
  [AmlReason.RECEIVER_REJECTED_TX]: TransactionReason.RECEIVER_REJECTED,
  [AmlReason.CHF_ABROAD_TX]: TransactionReason.CHF_ABROAD_NOT_ALLOWED,
  [AmlReason.ASSET_KYC_NEEDED]: TransactionReason.ASSET_KYC_NEEDED,
  [AmlReason.CARD_NAME_MISMATCH]: TransactionReason.CARD_NAME_MISMATCH,
  [AmlReason.VIDEO_IDENT_NEEDED]: TransactionReason.VIDEO_IDENT_NEEDED,
  [AmlReason.MISSING_LIQUIDITY]: TransactionReason.MISSING_LIQUIDITY,
  [AmlReason.TEST_ONLY]: TransactionReason.UNKNOWN,
  [AmlReason.KYC_DATA_NEEDED]: TransactionReason.KYC_DATA_NEEDED,
};

export class UnassignedTransactionDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'UID of the transaction' })
  uid: string;

  @ApiPropertyOptional({ description: 'UID of the order of the transaction' })
  orderUid?: string;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ enum: TransactionState })
  state: TransactionState;

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

  @ApiPropertyOptional({ description: 'Chargeback address or chargeback IBAN' })
  chargebackTarget?: string;

  @ApiPropertyOptional({ description: 'Chargeback amount in input asset' })
  chargebackAmount?: number;

  @ApiPropertyOptional()
  chargebackAsset?: string;

  @ApiPropertyOptional({ description: 'Fiat ID for sell transactions, asset ID otherwise' })
  chargebackAssetId?: number;

  @ApiPropertyOptional()
  chargebackTxId?: string;

  @ApiPropertyOptional()
  chargebackTxUrl?: string;

  @ApiPropertyOptional({ type: Date })
  chargebackDate?: Date;

  @ApiProperty({ type: Date })
  date: Date;
}

export class TransactionDto extends UnassignedTransactionDto {
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

  @ApiPropertyOptional({ type: Date })
  outputDate?: Date;

  @ApiPropertyOptional()
  priceSteps?: PriceStep[];

  @ApiPropertyOptional({ description: 'Fee amount in input asset', deprecated: true })
  feeAmount?: number;

  @ApiPropertyOptional({ deprecated: true })
  feeAsset?: string;

  @ApiPropertyOptional({ type: FeeDto, description: 'Fee infos in input asset' })
  fees?: FeeDto;

  @ApiPropertyOptional()
  externalTransactionId?: string;
}

export class TransactionDetailDto extends TransactionDto {
  @ApiPropertyOptional()
  sourceAccount?: string;

  @ApiPropertyOptional()
  targetAccount?: string;
}

export class TransactionTarget {
  @ApiProperty()
  id: number;

  @ApiProperty()
  bankUsage: string;

  @ApiProperty({ type: AssetDto })
  asset: AssetDto;

  @ApiProperty()
  address: string;
}
