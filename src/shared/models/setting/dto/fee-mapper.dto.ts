import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateFeeMapperDto {
  @IsNotEmpty()
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  ref: string;

  @IsOptional()
  @IsArray()
  fee: number[];

  @IsOptional()
  @IsNumber()
  wallet: number;
}

export class FeeMapper {
  label: string;
  ref: string;
  fee: number[];
  wallet: number;
}
