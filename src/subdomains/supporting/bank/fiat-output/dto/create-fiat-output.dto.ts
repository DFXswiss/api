import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFiatOutputDto {
  @IsOptional()
  @IsNumber()
  buyFiatId: number;

  @IsNotEmpty()
  @IsString()
  type: string;
}
