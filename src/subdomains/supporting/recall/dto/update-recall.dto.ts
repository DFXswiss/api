import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateRecallDto {
  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsNumber()
  fee?: number;
}
