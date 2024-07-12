import { ApiProperty } from '@nestjs/swagger';

export class BankDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  iban: string;

  @ApiProperty()
  bic: string;

  @ApiProperty()
  currency: string;
}
