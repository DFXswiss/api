import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';

export class LinkedUserInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.address)
  address: string;
}

export class LinkedUserOutDto extends LinkedUserInDto {
  @ApiProperty({ enum: Blockchain, isArray: true })
  blockchains: Blockchain[];
}
