import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendMailDto {
  @IsNotEmpty()
  @IsEmail()
  to: string;

  @IsOptional()
  @IsString()
  displayName: string;

  @IsOptional()
  @IsEmail()
  from: string;

  @IsOptional()
  @IsEmail()
  cc: string;

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

  @IsOptional()
  @IsString()
  template: string;

  @IsOptional()
  @IsString()
  telegramUrl: string;

  @IsOptional()
  @IsString()
  instagramUrl: string;

  @IsOptional()
  @IsString()
  linkedinUrl: string;

  @IsOptional()
  @IsString()
  twitterUrl: string;
}
