import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export class LinkedUserInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  address: string;
}

export class LinkedUserOutDto extends LinkedUserInDto {
  @ApiProperty({ enum: Blockchain, isArray: true })
  blockchains: Blockchain[];
}
