import { ApiProperty } from '@nestjs/swagger';
import { BankName } from '../bank.entity';

export class BankDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: BankName })
  name: BankName;

  @ApiProperty()
  iban: string;

  @ApiProperty()
  bic: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  receive: boolean;

  @ApiProperty()
  send: boolean;

  @ApiProperty()
  sctInst: boolean;
}
