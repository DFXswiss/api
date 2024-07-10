import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
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
  currency: FiatDto;

  @ApiProperty()
  @IsEnum(PaymentLinkPaymentMode)
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

  @ApiPropertyOptional()
  externalId: string;

  @ApiProperty()
  @IsEnum(PaymentLinkStatus)
  status: PaymentLinkStatus;

  @ApiPropertyOptional()
  payment: PaymentLinkPaymentDto;
}
