import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class BankAccountDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  iban: string;

  @ApiPropertyOptional({ type: Fiat })
  preferredCurrency: Fiat;

  @ApiPropertyOptional()
  label: string;

  @ApiProperty({ deprecated: true })
  sepaInstant: boolean;

  @ApiProperty({ deprecated: true })
  active: boolean;
}
