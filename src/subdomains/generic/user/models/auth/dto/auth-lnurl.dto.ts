import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { OptionalSignUpDto } from './auth-credentials.dto';
import { Transform } from 'class-transformer';
import { Util } from 'src/shared/utils/util';

export class AuthLnurlSignupDto extends OptionalSignUpDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  tag: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  action: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  k1: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  sig: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
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
