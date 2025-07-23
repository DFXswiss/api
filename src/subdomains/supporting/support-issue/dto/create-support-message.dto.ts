import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class CreateSupportMessageDto {
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  author?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  message?: string;
}
