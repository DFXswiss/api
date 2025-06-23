import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class Verify2faDto {
  @ApiProperty({ description: '2FA token' })
  @IsNotEmpty()
  @IsString()
  token: string;
}
