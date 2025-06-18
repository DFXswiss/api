import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class VerifyMailDto {
  @ApiProperty({ description: 'Email verification token' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  token: string;
}
