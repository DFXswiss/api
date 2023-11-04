import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateCustomSignUpFeesDto {
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

export class CustomSignUpFees {
  label: string;
  ref: string;
  fees: number[];
  wallet: number;
}
