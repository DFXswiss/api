import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsNotEmpty, IsString } from 'class-validator';
import { RefRewardDto } from './ref-reward.dto';

export class CreateRefRewardDto extends RefRewardDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  txId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  internalId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsInt()
  userId: number;
}
