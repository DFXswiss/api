import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class DepositDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  address: string;

  @ApiProperty({ enum: Blockchain })
  blockchain: Blockchain;
}
