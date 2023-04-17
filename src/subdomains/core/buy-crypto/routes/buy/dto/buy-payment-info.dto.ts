import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  fee: number;

  @ApiProperty()
  remittanceInfo: string;

  @ApiProperty({ type: MinAmount })
  minDeposit: MinAmount;

  @ApiProperty({ type: MinAmount })
  minFee: MinAmount;
}
