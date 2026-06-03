import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkPaymentStatus } from 'src/subdomains/core/payment-link/enums';
import { RealUnitSellBroadcastDto } from './realunit-sell.dto';

// --- Swap-only (REALU -> ZCHF, proceeds stay in the user wallet) --- //

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
