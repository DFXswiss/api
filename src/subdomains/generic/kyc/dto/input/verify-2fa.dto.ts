import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class Verify2faDto {
  @ApiProperty({ description: '2FA token' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  token: string;
}
