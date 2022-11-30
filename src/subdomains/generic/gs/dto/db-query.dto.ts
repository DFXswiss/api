import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class DbQueryBaseDto {
  @IsNotEmpty()
  @IsString()
  table: string;

  @IsNotEmpty()
  @IsNumber()
  min = 1;

  @IsOptional()
  @IsNumber()
  maxLine: number;

  @IsNotEmpty()
  @IsDate()
  updatedSince: Date = new Date(0);

  @IsNotEmpty()
  @IsString()
  sorting: 'ASC' | 'DESC' = 'ASC';

  // Comma separated column names
  @IsOptional()
  select?: string[];
}

export class DbQueryDto extends DbQueryBaseDto {
  @IsNotEmpty()
  join?: [string, string][] = [];

  @IsNotEmpty()
  where?: [string, { [key: string]: string }][] = [];
}
