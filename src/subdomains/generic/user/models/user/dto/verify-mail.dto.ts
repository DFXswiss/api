import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyMailDto {
  @ApiProperty({ description: 'Email verification token' })
  @IsNotEmpty()
  @IsString()
  token: string;
}

export enum UpdateMailStatus {
  Accepted = 'accepted',
  Ok = 'ok',
}
