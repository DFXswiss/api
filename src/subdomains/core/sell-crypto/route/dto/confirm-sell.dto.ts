import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';

export class PermitDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.signature)
  signature: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  nonce: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  deadline: number;
}

export class ConfirmSellDto {
  @ApiProperty({ type: PermitDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => PermitDto)
  permit: PermitDto;
}