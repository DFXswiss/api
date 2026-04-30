import { Type } from 'class-transformer';
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
  @Type(() => Date)
  updatedSince: Date = new Date(0);

  @IsNotEmpty()
  @IsString()
  sortColumn = 'id';

  @IsNotEmpty()
  @IsString()
  sorting: 'ASC' | 'DESC' = 'ASC';

  @IsOptional()
  select?: string[]; // user file structure: documents-$prefix.{userData}.$suffix

  @IsOptional()
  @IsString()
  identifier: string;
}

export class DbQueryDto extends DbQueryBaseDto {
  @IsNotEmpty()
  join?: [string, string][] = [];

  @IsNotEmpty()
  where?: [string, { [key: string]: string }][] = [];
}

export class DbReturnData {
  keys: string[];
  values: any;
}
