import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class AuthCredentialsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(8\w{33}|d\w{33}|d\w{41})$/)
  address: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^.{87}=$/)
  signature: string;
}
