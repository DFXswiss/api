import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class AuthCredentialsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(8\w{33}|d\w{33}|d\w{41})$/)
  address: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Length(88, 96)
  signature: string;
}
