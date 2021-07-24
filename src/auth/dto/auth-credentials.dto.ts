import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class AuthCredentialsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Length(34, 34)
  address: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Length(88, 88)
  signature: string;
}
