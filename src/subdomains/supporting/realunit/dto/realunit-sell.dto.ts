import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDfxIban, IbanType } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { PriceStep } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { Util } from 'src/shared/utils/util';
import { XOR } from 'src/shared/validators/xor.validator';
import { Eip7702ConfirmDto } from 'src/subdomains/core/sell-crypto/route/dto/eip7702-delegation.dto';

// --- Enums ---

export enum RealUnitSellCurrency {
  CHF = 'CHF',
  EUR = 'EUR',
}

// --- Request DTOs ---

export class RealUnitSellDto {
  @ApiPropertyOptional({ description: 'Amount of REALU tokens to sell' })
  @ValidateIf((b: RealUnitSellDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'Target amount in fiat currency (alternative to amount)' })
  @ValidateIf((b: RealUnitSellDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  targetAmount?: number;

  @ApiProperty({ description: 'IBAN for receiving funds' })
  @IsNotEmpty()
  @IsString()
  @IsDfxIban(IbanType.SELL)
  @Transform(Util.trimAll)
  iban: string;

  @ApiPropertyOptional({
    enum: RealUnitSellCurrency,
    description: 'Target currency (CHF or EUR)',
    default: RealUnitSellCurrency.CHF,
  })
  @IsOptional()
  @IsEnum(RealUnitSellCurrency)
  currency?: RealUnitSellCurrency;
}

export class RealUnitSellConfirmDto {
  @ApiPropertyOptional({ type: Eip7702ConfirmDto, description: 'EIP-7702 delegation for gasless transfer' })
  @IsOptional()
  @ValidateNested()
  @Type(() => Eip7702ConfirmDto)
  eip7702?: Eip7702ConfirmDto;

  @ApiPropertyOptional({ description: 'Transaction hash if user sent manually (fallback)' })
  @IsOptional()
  @IsString()
  txHash?: string;
}

// --- EIP-7702 Data DTO (extended for RealUnit) ---

export class RealUnitEip7702DataDto {
  @ApiProperty({ description: 'Relayer address that will execute the transaction' })
  relayerAddress: string;

  @ApiProperty({ description: 'DelegationManager contract address' })
  delegationManagerAddress: string;

  @ApiProperty({ description: 'Delegator contract address' })
  delegatorAddress: string;

  @ApiProperty({ description: 'User account nonce for EIP-7702 authorization' })
  userNonce: number;

  @ApiProperty({ description: 'EIP-712 domain for delegation signature' })
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };

  @ApiProperty({ description: 'EIP-712 types for delegation signature' })
  types: {
    Delegation: Array<{ name: string; type: string }>;
    Caveat: Array<{ name: string; type: string }>;
  };

  @ApiProperty({ description: 'Delegation message to sign' })
  message: {
    delegate: string;
    delegator: string;
    authority: string;
    caveats: any[];
    salt: number;
  };

  // Additional fields for token transfer
  @ApiProperty({ description: 'REALU token contract address' })
  tokenAddress: string;

  @ApiProperty({ description: 'Amount in wei (token smallest unit)' })
  amountWei: string;

  @ApiProperty({ description: 'Deposit address (where tokens will be sent)' })
  depositAddress: string;
}

// --- Response DTO ---

export class BeneficiaryDto {
  @ApiProperty({ description: 'Beneficiary name' })
  name: string;

  @ApiProperty({ description: 'Beneficiary IBAN' })
  iban: string;
}

export class RealUnitSellPaymentInfoDto {
  // --- Identification ---
  @ApiProperty({ description: 'Transaction request ID' })
  id: number;

  @ApiProperty({ description: 'Route ID' })
  routeId: number;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  // --- EIP-7702 Delegation Data (ALWAYS present for RealUnit) ---
  @ApiProperty({ type: RealUnitEip7702DataDto, description: 'EIP-7702 delegation data for gasless transfer' })
  eip7702: RealUnitEip7702DataDto;

  // --- Fallback Transfer Info (ALWAYS present) ---
  @ApiProperty({ description: 'Deposit address for manual transfer (fallback)' })
  depositAddress: string;

  @ApiProperty({ description: 'Amount of REALU to transfer' })
  amount: number;

  @ApiProperty({ description: 'REALU token contract address' })
  tokenAddress: string;

  @ApiProperty({ description: 'Chain ID (Base = 8453)' })
  chainId: number;

  // --- Fee Info ---
  @ApiProperty({ type: FeeDto, description: 'Fee infos in source asset' })
  fees: FeeDto;

  @ApiProperty({ description: 'Minimum volume in REALU' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in REALU' })
  maxVolume: number;

  @ApiProperty({ description: 'Minimum volume in target currency' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target currency' })
  maxVolumeTarget: number;

  // --- Rate Info ---
  @ApiProperty({ description: 'Exchange rate in source/target' })
  exchangeRate: number;

  @ApiProperty({ description: 'Final rate (incl. fees) in source/target' })
  rate: number;

  @ApiProperty({ type: PriceStep, isArray: true })
  priceSteps: PriceStep[];

  // --- Result ---
  @ApiProperty({ description: 'Estimated fiat amount to receive' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Target currency (CHF or EUR)' })
  currency: string;

  @ApiProperty({ type: BeneficiaryDto, description: 'Beneficiary information (IBAN recipient)' })
  beneficiary: BeneficiaryDto;

  // --- Validation ---
  @ApiProperty({ description: 'Whether the transaction is valid' })
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error message in case isValid is false' })
  error?: QuoteError;
}
