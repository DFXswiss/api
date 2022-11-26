import { IsBoolean, IsDate, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class dbQueryDto {
  @IsNotEmpty()
  @IsString()
  table: string;

  @IsOptional()
  @IsNumber()
  min: number = 1;

  @IsOptional()
  @IsNumber()
  maxLine: number;

  @IsOptional()
  @IsDate()
  updatedSince: Date = new Date(0);

  @IsOptional()
  @IsBoolean()
  extended: boolean = false;

  @IsOptional()
  @IsBoolean()
  oldGsLogic: boolean = true;

  @IsOptional()
  @IsString()
  sorting: 'ASC' | 'DESC' = 'ASC';

  // Comma separated column names
  @IsOptional()
  select?: string[];

  // Comma separated join names
  @IsOptional()
  join?: [string, string][] = [];

  // Comma separated where clauses
  @IsOptional()
  where?: [string, {}][] = [];
}
