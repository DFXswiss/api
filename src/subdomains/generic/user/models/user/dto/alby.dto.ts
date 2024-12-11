import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { OptionalSignUpDto } from '../../auth/dto/auth-credentials.dto';

export class AlbySignupDto extends OptionalSignUpDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  redirectUri: string;
}
