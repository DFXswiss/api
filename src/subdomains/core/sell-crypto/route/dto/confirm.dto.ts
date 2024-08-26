import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsString, Matches, ValidateNested } from 'class-validator';
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
  @IsString()
  @Matches(GetConfig().formats.address)
  signatureTransferContract: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  permittedAmount: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  executorAddress: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  nonce: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  deadline: string;
}

export class ConfirmDto {
  @ApiProperty({ type: PermitDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => PermitDto)
  permit: PermitDto;
}
