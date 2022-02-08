import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateMasternodeDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  hash: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  owner: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  operator: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  server: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  timelock: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  enabled: boolean;
}
