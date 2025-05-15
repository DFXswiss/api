import { ApiProperty } from '@nestjs/swagger';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';

export class PaymentRecipientDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: FiatDto })
  currency: FiatDto;
}
