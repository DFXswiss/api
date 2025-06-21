import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsString, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Util } from 'src/shared/utils/util';

export class PermitDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.address)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.signature)
  signature: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.address)
  signatureTransferContract: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  permittedAmount: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @Matches(GetConfig().formats.address)
  executorAddress: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  nonce: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  deadline: string;
}

export class ConfirmDto {
  @ApiProperty({ type: PermitDto })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => PermitDto)
  permit: PermitDto;
}
