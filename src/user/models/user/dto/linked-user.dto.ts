import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Blockchain } from 'src/ain/node/node.service';
import { GetConfig } from 'src/config/config';

export class LinkedUserDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().addressFormat)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain;

  @ApiPropertyOptional()
  @IsBoolean()
  isSwitchable: boolean;
}
