import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ErrorDto } from 'src/shared/dto/error.dto';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentLinkStatus, PaymentStandard } from '../enums';
import { PaymentLinkConfigDto } from './payment-link-config.dto';
import { PaymentLinkRecipientDto } from './payment-link-recipient.dto';

export type TransferMethod = Blockchain | string;

export interface TransferInfo {
  asset: string;
  amount: number;
  method: TransferMethod;
  quoteUniqueId: string;
  tx: string;
  hex: string;
}

export interface TransferAmount {
  method: TransferMethod;
  minFee: number;
  assets: TransferAmountAsset[];
  available: boolean;
}

export interface TransferAmountAsset {
  asset: string;
  amount: number;
}

export type RequestedAmountAsset = TransferAmountAsset;

export interface PaymentLinkRequestDto {
  id: string;
  externalId?: string;
  displayName: string;
  standard: PaymentStandard;
  possibleStandards: PaymentStandard[];
  displayQr: boolean;
  recipient: PaymentLinkRecipientDto;
}

export interface PaymentLinkPayRequestDto extends PaymentLinkRequestDto {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  quote: {
    id: string;
    expiration: Date;
    payment: string;
  };
  requestedAmount: RequestedAmountAsset;
  transferAmounts: TransferAmount[];
}

export interface PaymentLinkPaymentErrorResponseDto extends PaymentLinkRequestDto, ErrorDto {}

export interface PaymentLinkEvmPaymentDto {
  expiryDate: Date;
  blockchain: Blockchain;
  uri: string;
  hint: string;
}

export interface PaymentLinkHexResultDto {
  txId: string;
}

export class PaymentLinkPaymentDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional()
  externalId: string;

  @ApiPropertyOptional()
  note: string;

  @ApiProperty({ enum: PaymentLinkPaymentStatus })
  status: PaymentLinkPaymentStatus;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: PaymentLinkPaymentMode })
  mode: PaymentLinkPaymentMode;

  @ApiProperty()
  expiryDate: Date;

  @ApiProperty()
  txCount: number;

  @ApiProperty()
  isConfirmed: boolean;

  @ApiProperty()
  url: string;

  @ApiProperty()
  lnurl: string;

  updatedAt: Date;
}

export class PaymentLinkBaseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  routeId: number;

  @ApiPropertyOptional()
  externalId?: string;

  @ApiPropertyOptional()
  label?: string;

  @ApiPropertyOptional()
  webhookUrl?: string;

  @ApiProperty({ enum: PaymentLinkStatus })
  status: PaymentLinkStatus;

  @ApiProperty()
  url: string;

  @ApiProperty()
  lnurl: string;

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  recipient?: PaymentLinkRecipientDto;

  @ApiPropertyOptional({ type: PaymentLinkConfigDto })
  config?: PaymentLinkConfigDto;
}

export class PaymentLinkDto extends PaymentLinkBaseDto {
  @ApiPropertyOptional({ type: PaymentLinkPaymentDto })
  payment?: PaymentLinkPaymentDto;
}

export class PaymentLinkHistoryDto extends PaymentLinkBaseDto {
  @ApiPropertyOptional({ type: PaymentLinkPaymentDto, isArray: true })
  payments?: PaymentLinkPaymentDto[];
}
