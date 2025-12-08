import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class BroadcastSellDto {
  @ApiProperty({ description: 'Signed transaction hex' })
  @IsNotEmpty()
  @IsString()
  hex: string;

  @ApiProperty({ description: 'Blockchain network', enum: Blockchain })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;
}
