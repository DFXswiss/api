import { ApiProperty } from '@nestjs/swagger';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class BankAccountDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  iban: string;

  @ApiProperty({ type: Fiat })
  preferredCurrency: Fiat;

  @ApiProperty()
  label: string;

  @ApiProperty()
  sepaInstant: boolean;
}
