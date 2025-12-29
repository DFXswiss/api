import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { OptionalSignUpDto } from './auth-credentials.dto';

export class AuthLnurlSignupDto extends OptionalSignUpDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  tag: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  action: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  k1: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  sig: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  key: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  signature: string;
}

export enum AuthLnurlResponseStatus {
  OK = 'OK',
  ERROR = 'ERROR',
}

export class AuthLnurlSignInResponseDto {
  static createOk(): AuthLnurlSignInResponseDto {
    return { status: AuthLnurlResponseStatus.OK };
  }

  static createError(reason: string): AuthLnurlSignInResponseDto {
    return { status: AuthLnurlResponseStatus.ERROR, reason: reason };
  }

  @ApiProperty({ enum: AuthLnurlResponseStatus })
  status: AuthLnurlResponseStatus;

  @ApiPropertyOptional()
  reason?: string;
}

export class AuthLnurlCreateLoginResponseDto {
  @ApiProperty()
  k1: string;

  @ApiProperty()
  lnurl: string;
}

export class AuthLnurlStatusResponseDto {
  @ApiProperty()
  isComplete: boolean;

  @ApiPropertyOptional()
  accessToken?: string;
}
