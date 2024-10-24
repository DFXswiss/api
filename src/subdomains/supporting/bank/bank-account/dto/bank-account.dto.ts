import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class BankAccountDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  iban: string;

  @ApiPropertyOptional({ type: FiatDto })
  preferredCurrency: FiatDto;

  @ApiPropertyOptional()
  label: string;

  @ApiProperty({ deprecated: true })
  sepaInstant: boolean;

  @ApiProperty({ deprecated: true })
  active: boolean;
}
