import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Config } from 'src/config/config';

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
  banner: string;

  @IsOptional()
  @IsNumber()
  date: number = new Date().getFullYear();

  @IsOptional()
  @IsString()
  telegramUrl: string = Config.defaultTelegramUrl;

  @IsOptional()
  @IsString()
  instagramUrl: string = Config.defaultInstagramUrl;

  @IsOptional()
  @IsString()
  linkedinUrl: string = Config.defaultLinkedinUrl;

  @IsOptional()
  @IsString()
  twitterUrl: string = Config.defaultTwitterUrl;
}
