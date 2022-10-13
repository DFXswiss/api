import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class dbQueryDto {
  @IsNotEmpty()
  @IsString()
  table: string;

  @IsOptional()
  min: number;

  @IsOptional()
  maxLine: number;

  @IsOptional()
  updatedSince: Date;

  @IsOptional()
  extended: boolean;

  @IsOptional()
  @IsString()
  sorting: 'ASC' | 'DESC' = 'ASC';

  @IsOptional()
  @IsString()
  customCols?: string;
}
