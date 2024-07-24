import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export enum PaymentLinkStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export enum PaymentLinkPaymentStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export enum PaymentLinkPaymentMode {
  SINGLE = 'Single',
  MULTIPLE = 'Multiple',
}

export type TransferMethod = Blockchain;

export interface TransferInfo {
  asset: string;
  amount: number;
  method: TransferMethod;
}

export interface PaymentLinkPayRequestDto {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  transferAmounts: TransferInfo[];
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
