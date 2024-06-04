import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class DepositDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  address: string;

  @ApiProperty({ enum: Blockchain, deprecated: true })
  blockchain: Blockchain;

  @ApiProperty({ enum: Blockchain, isArray: true })
  blockchains: Blockchain[];
}
