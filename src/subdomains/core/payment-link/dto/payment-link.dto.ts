import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
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
  minFee: number;
  assets: TransferAmountAsset[];
}

export interface TransferAmountAsset {
  asset: string;
  amount: number;
}

export type RequestedAmountAsset = TransferAmountAsset;

export interface PaymentLinkPayRequestDto {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  displayName: string;
  recipient: PaymentLinkRecipientDto;
  quote: {
    id: string;
    expiration: Date;
  };
  requestedAmount: RequestedAmountAsset;
  transferAmounts: TransferAmount[];
}

export interface PaymentLinkEvmPaymentDto {
  expiryDate: Date;
  blockchain: Blockchain;
  uri: string;
}

export class PaymentLinkRecipientAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  street?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  houseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zip?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;
}

export class PaymentLinkRecipientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: PaymentLinkRecipientAddressDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  address?: PaymentLinkRecipientAddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;
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
  externalId?: string;

  @ApiPropertyOptional()
  webhookUrl?: string;

  @ApiProperty({ enum: PaymentLinkStatus })
  status: PaymentLinkStatus;

  @ApiProperty()
  url: string;

  @ApiProperty()
  lnurl: string;

  @ApiPropertyOptional({ type: PaymentLinkPaymentDto })
  payment?: PaymentLinkPaymentDto;

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  recipient?: PaymentLinkRecipientDto;
}
