import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendMailDto {
  @IsNotEmpty()
  @IsEmail()
  to: string;

  @IsOptional()
  @IsEmail()
  from: string;

  @IsOptional()
  @IsEmail()
  bcc: string;

  @IsNotEmpty()
  @IsString()
  salutation: string;

  @IsNotEmpty()
  @IsString()
  subject: string;

  @IsNotEmpty()
  @IsString()
  body: string;
}
