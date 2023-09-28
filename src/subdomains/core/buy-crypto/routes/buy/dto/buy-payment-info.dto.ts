import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { MinAmount } from 'src/shared/payment/dto/min-amount.dto';

export class BankInfoDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  street: string;

  @ApiProperty()
  number: string;

  @ApiProperty()
  zip: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  country: string;

  @ApiPropertyOptional()
  iban: string;

  @ApiProperty()
  bic: string;

  @ApiProperty()
  sepaInstant: boolean;
}

export class BuyPaymentInfoDto extends BankInfoDto {
  @ApiProperty()
  routeId: number;

  @ApiProperty()
  remittanceInfo: string;

  @ApiProperty({ type: MinAmount, deprecated: true })
  minDeposit: MinAmount;

  @ApiProperty({ description: 'Fee in percentage' })
  fee: number;

  @ApiProperty({ description: 'Minimum fee in source currency' })
  minFee: number;

  @ApiProperty({ description: 'Minimum volume in source currency' })
  minVolume: number;

  @ApiProperty({ description: 'Amount in source currency' })
  amount: number;

  @ApiProperty({ type: FiatDto, description: 'Source currency' })
  currency: FiatDto;

  @ApiProperty({ description: 'Minimum fee in target asset' })
  minFeeTarget: number;

  @ApiProperty({ description: 'Minimum volume in target asset' })
  minVolumeTarget: number;

  @ApiProperty({ description: 'Estimated amount in target asset' })
  estimatedAmount: number;

  @ApiProperty({ type: AssetDto, description: 'Target asset' })
  asset: AssetDto;

  @ApiPropertyOptional({ description: 'Payment request (e.g. GiroCode content)' })
  paymentRequest?: string;

  @ApiPropertyOptional({ description: 'Payment link (e.g. to pay with credit card)' })
  paymentLink?: string;

  @ApiProperty()
  isValid: boolean;
}
