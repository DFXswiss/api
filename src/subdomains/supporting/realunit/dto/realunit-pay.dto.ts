import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsPositive, IsString, Validate, ValidateIf } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { XOR } from 'src/shared/validators/xor.validator';
import { PaymentLinkPaymentStatus } from 'src/subdomains/core/payment-link/enums';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { RealUnitSellBroadcastDto } from './realunit-sell.dto';

// --- Swap quote (REALU -> ZCHF, proceeds stay in the user wallet, IBAN-free) --- //

// Input mirrors the sell DTO's amount XOR targetAmount pattern but drops `iban` and `currency`:
// the swap target is always ZCHF (the on-chain brokerbot base currency), so no fiat Sell route / payout
// is involved. `amount` is REALU shares, `targetAmount` is ZCHF.
export class RealUnitSwapDto {
  @ApiPropertyOptional({ description: 'Amount of REALU shares to swap' })
  @ValidateIf((b: RealUnitSwapDto) => Boolean(b.amount || !b.targetAmount))
  @Validate(XOR, ['targetAmount'])
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiPropertyOptional({ description: 'Target amount in ZCHF (alternative to amount)' })
  @ValidateIf((b: RealUnitSwapDto) => Boolean(b.targetAmount || !b.amount))
  @Validate(XOR, ['amount'])
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  targetAmount?: number;
}

export class RealUnitSwapPaymentInfoDto {
  // --- Identification ---
  @ApiProperty({ description: 'Transaction request ID (feeds PUT /swap/:id/unsigned-transaction)' })
  id: number;

  @ApiProperty({ description: 'Transaction request UID' })
  uid: string;

  @ApiProperty({ description: 'Swap route ID' })
  routeId: number;

  @ApiProperty({ description: 'Price timestamp' })
  timestamp: Date;

  // --- Amounts ---
  @ApiProperty({ description: 'Amount of REALU shares to swap' })
  amount: number;

  @ApiProperty({ description: 'Estimated ZCHF amount the swap will pay out' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Target asset name (always ZCHF)' })
  targetAsset: string;

  // --- Fee Info ---
  @ApiProperty({ type: FeeDto, description: 'Fee infos in source asset (REALU)' })
  fees: FeeDto;

  @ApiProperty({ description: 'Minimum volume in REALU shares' })
  minVolume: number;

  @ApiProperty({ description: 'Maximum volume in REALU shares' })
  maxVolume: number;

  @ApiProperty({ description: 'Minimum volume in target asset (ZCHF)' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Maximum volume in target asset (ZCHF)' })
  maxVolumeTarget: number;

  // --- Gas Info ---
  @ApiProperty({ description: 'User ETH balance on the token chain' })
  ethBalance: number;

  @ApiProperty({ description: 'Required ETH to cover gas for the brokerbot swap step' })
  requiredGasEth: number;

  // --- Validation ---
  @ApiProperty({ description: 'Whether the swap quote is valid' })
  isValid: boolean;

  @ApiPropertyOptional({ enum: QuoteError, description: 'Error code in case isValid is false (e.g. LIMIT_EXCEEDED)' })
  error?: QuoteError;
}

// --- Swap-only unsigned transaction (REALU -> ZCHF, proceeds stay in the user wallet) --- //

export class RealUnitSwapUnsignedTransactionDto {
  @ApiProperty({ description: 'Unsigned REALU transferAndCall swap transaction (serialized EIP-1559 hex)' })
  swap: string;
}

// --- OCP pay (settle a ZCHF payment-link quote via the public lnurlp flow) --- //

export class RealUnitOcpPayDto {
  @ApiProperty({
    description:
      'Payment-link or payment-link-payment unique id decoded from the OCP LNURL (e.g. "pl_..." / "plp_...")',
  })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  paymentLinkId: string;

  @ApiProperty({ description: 'Quote unique id decoded from the OCP pay request' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  quoteId: string;
}

// Extends the sell broadcast DTO (same unsigned-tx + signature shape) and adds the payment-link/quote
// references so the signed hex can be submitted into the existing lnurlp tx settlement path.
export class RealUnitOcpPaySubmitDto extends RealUnitSellBroadcastDto {
  @ApiProperty({ description: 'Payment-link or payment-link-payment unique id of the OCP payment' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  paymentLinkId: string;

  @ApiProperty({ description: 'Quote unique id of the OCP payment' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  quoteId: string;
}

export class RealUnitOcpPayUnsignedTransactionDto {
  @ApiProperty({
    description: 'Unsigned ZCHF ERC-20 transfer transaction to the OCP recipient (serialized EIP-1559 hex)',
  })
  unsignedTx: string;

  @ApiProperty({ description: 'ZCHF token contract address (recipient of the transfer call)' })
  tokenAddress: string;

  @ApiProperty({ description: 'Recipient address that receives the ZCHF transfer (DFX deposit address for the quote)' })
  recipient: string;

  @ApiProperty({ description: 'ZCHF amount to transfer (in token smallest unit / wei)' })
  amountWei: string;

  @ApiProperty({ description: 'EVM chain id of the ZCHF token' })
  chainId: number;
}

export class RealUnitOcpPayResultDto {
  @ApiProperty({ description: 'Blockchain transaction id of the submitted ZCHF payment' })
  txId: string;
}

export class RealUnitOcpPayStatusDto {
  @ApiProperty({ enum: PaymentLinkPaymentStatus, description: 'Status of the OCP payment' })
  status: PaymentLinkPaymentStatus;
}
