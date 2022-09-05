import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Blockchain } from 'src/ain/services/crypto.service';
import { GetConfig } from 'src/config/config';

export class LinkedUserInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().addressFormat)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;
}

export class LinkedUserOutDto extends LinkedUserInDto {
  @ApiProperty()
  isSwitchable: boolean;
}
