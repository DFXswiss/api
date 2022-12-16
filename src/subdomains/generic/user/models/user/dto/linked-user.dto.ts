import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GetConfig } from 'src/config/config';

export class LinkedUserInDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().addressFormat)
  address: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(Blockchain)
  blockchain: Blockchain;
}

export class LinkedUserOutDto extends LinkedUserInDto {
  @ApiProperty()
  isSwitchable: boolean;

  // TODO: Two times blockchain
  @ApiProperty({ enum: Blockchain, isArray: true })
  blockchain: Blockchain;
}
