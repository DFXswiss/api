import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ErrorDto } from 'src/shared/dto/error.dto';
import { PaymentLinkPaymentMode, PaymentLinkPaymentStatus, PaymentLinkStatus, PaymentStandard } from '../enums';

export type TransferMethod = Blockchain;

export interface TransferInfo {
  asset: string;
  amount: number;
  method: TransferMethod;
  quoteUniqueId: string;
  hex: string;
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

export interface PaymentLinkRequestDto {
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

export interface PaymentLinkPaymentNotFoundDto extends PaymentLinkRequestDto, ErrorDto {}

export interface PaymentLinkEvmPaymentDto {
  expiryDate: Date;
  blockchain: Blockchain;
  uri: string;
}

export interface PaymentLinkHexResultDto {
  txId: string;
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

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: PaymentLinkPaymentMode })
  mode: PaymentLinkPaymentMode;

  @ApiProperty()
  expiryDate: Date;

  @ApiProperty()
  txCount: number;

  @ApiProperty()
  url: string;

  @ApiProperty()
  lnurl: string;
}

export class PaymentLinkBaseDto {
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

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  recipient?: PaymentLinkRecipientDto;
}

export class PaymentLinkDto extends PaymentLinkBaseDto {
  @ApiPropertyOptional({ type: PaymentLinkPaymentDto })
  payment?: PaymentLinkPaymentDto;
}

export class PaymentLinkHistoryDto extends PaymentLinkBaseDto {
  @ApiPropertyOptional({ type: PaymentLinkPaymentDto, isArray: true })
  payment?: PaymentLinkPaymentDto[];
}
