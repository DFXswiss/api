import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class AlchemySyncTransactionsDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiProperty()
  @IsNotEmpty()
  fromBlock: number;

  @ApiProperty()
  @IsNotEmpty()
  toBlock: number;

  @ApiProperty()
  @IsNotEmpty()
  address: string;
}
