import { ApiProperty } from '@nestjs/swagger';
import { MinDeposit } from '../../deposit/dto/min-deposit.dto';

export class BankInfoDto {
  @ApiProperty()
  receiveName: string;

  @ApiProperty()
  location: string;

  @ApiProperty()
  zipLocation: string;

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

  @ApiProperty()
  minDeposits: MinDeposit[];
}

export enum Bank {
  MAERKI = 'MaerkiBaumann',
  OLKY = 'Olky',
}
