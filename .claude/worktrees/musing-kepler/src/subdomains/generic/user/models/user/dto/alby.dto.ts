import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUrl } from 'class-validator';
import { OptionalSignUpDto } from '../../auth/dto/auth-credentials.dto';

export class AlbySignupDto extends OptionalSignUpDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUrl()
  redirectUri: string;
}
