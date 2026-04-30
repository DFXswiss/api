import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class UserNameDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  lastName: string;
}
