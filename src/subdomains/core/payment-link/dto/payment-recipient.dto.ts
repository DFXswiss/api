import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class PaymentRecipientDto {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional({ type: FiatDto })
  currency?: FiatDto;
}
