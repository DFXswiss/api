import { ApiProperty } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class SignMessageDto {
  @ApiProperty({
    description: 'Message to sign',
  })
  message: string;

  @ApiProperty({
    description: 'List of blockchains',
    isArray: true,
    enum: Blockchain,
  })
  blockchains: Blockchain[];
}
