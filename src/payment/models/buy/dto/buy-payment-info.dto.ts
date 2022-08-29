import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';

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

  @ApiProperty()
  iban: string;

  @ApiProperty()
  bic: string;
}

export class BuyPaymentInfoDto extends BankInfoDto {
  @ApiProperty()
  fee: number;

  @ApiProperty()
  refBonus: number;

  @ApiProperty()
  remittanceInfo: string;

  @ApiProperty({ type: MinDeposit, isArray: true })
  minDeposits: MinDeposit[];
}
