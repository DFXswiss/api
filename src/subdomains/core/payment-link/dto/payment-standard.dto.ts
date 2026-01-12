import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentStandard } from '../enums';

export class PaymentStandardDto {
  @ApiProperty({ enum: PaymentStandard })
  id: PaymentStandard;

  @ApiProperty()
  label: string;

  @ApiProperty()
  description: string;

  @ApiPropertyOptional()
  paymentIdentifierLabel?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  blockchain?: Blockchain;
}
