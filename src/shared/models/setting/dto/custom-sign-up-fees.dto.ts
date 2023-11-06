import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CustomSignUpFeesDto {
  @IsNotEmpty()
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  ref: string;

  @IsOptional()
  @IsArray()
  fees: number[];

  @IsOptional()
  @IsNumber()
  wallet: number;
}
