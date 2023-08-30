import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { OptionalSignUpDto } from './create-user.dto';

export class AlbySignupDto extends OptionalSignUpDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  redirectUri: string;
}
