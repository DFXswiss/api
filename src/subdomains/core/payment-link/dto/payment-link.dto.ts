import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

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

export interface TransferInfo {
  asset: string;
  amount: number;
  method: Blockchain;
}

export class PaymentLinkPaymentDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  uniqueId: string;

  @ApiProperty()
  externalId: string;

  @ApiProperty()
  status: PaymentLinkPaymentStatus;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: Fiat;

  @ApiProperty()
  mode: PaymentLinkPaymentMode;

  @ApiProperty()
  expiryDate: Date;
}

export class PaymentLinkDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  routeId: number;

  @ApiProperty()
  uniqueId: string;

  @ApiProperty()
  externalId: string;

  @ApiProperty()
  status: PaymentLinkStatus;

  @ApiPropertyOptional()
  payment: PaymentLinkPaymentDto;
}
