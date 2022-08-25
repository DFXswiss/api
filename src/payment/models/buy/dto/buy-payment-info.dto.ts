import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';

export class BankInfoDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  street: string;

  @ApiProperty()
  number: number;

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
  bankUsage: string;

  @ApiProperty()
  refBonus: number;

  @ApiProperty({ type: Array<MinDeposit>() })
  minDeposits: MinDeposit[];
}

export enum Bank {
  MAERKI = 'MaerkiBaumann',
  OLKY = 'Olky',
}
