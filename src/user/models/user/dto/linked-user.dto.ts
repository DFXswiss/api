import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { Blockchain } from 'src/ain/services/crypto.service';
import { GetConfig } from 'src/config/config';

export class LinkedUserInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().addressFormat)
  address: string;
}

export class LinkedUserOutDto extends LinkedUserInDto {
  @ApiProperty()
  isSwitchable: boolean;

  @ApiProperty({ enum: Blockchain, isArray: true })
  blockchains: Blockchain[];
}
