import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentLinkStatus } from '../enums';

export type TransferMethod = Blockchain;

export interface TransferInfo {
  asset: string;
  amount: number;
  method: TransferMethod;
  quoteUniqueId: string;
}

export interface TransferAmount {
  method: TransferMethod;
  assets: TransferAmountAsset[];
}

export interface TransferAmountAsset {
  asset: string;
  amount: number;
}

export interface PaymentLinkPayRequestDto {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  quoteId: string;
  transferAmounts: TransferAmount[];
}

export interface PaymentLinkEvmPaymentDto {
  expiryDate: Date;
  blockchain: Blockchain;
  uri: string;
}

export class PaymentLinkPaymentDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional()
  externalId: string;

  @ApiProperty({ enum: PaymentLinkPaymentStatus })
  status: PaymentLinkPaymentStatus;

  @ApiProperty()
  amount: number;

  @ApiProperty({ type: FiatDto })
  currency: FiatDto;

  @ApiProperty({ enum: PaymentLinkPaymentMode })
  mode: PaymentLinkPaymentMode;

  @ApiProperty()
  expiryDate: Date;

  @ApiProperty()
  url: string;

  @ApiProperty()
  lnurl: string;
}

export class PaymentLinkDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  routeId: number;

  @ApiPropertyOptional()
  externalId: string;

  @ApiProperty({ enum: PaymentLinkStatus })
  status: PaymentLinkStatus;

  @ApiProperty()
  url: string;

  @ApiProperty()
  lnurl: string;

  @ApiPropertyOptional({ type: PaymentLinkPaymentDto })
  payment: PaymentLinkPaymentDto;
}
