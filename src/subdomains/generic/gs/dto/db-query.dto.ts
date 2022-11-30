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
}

export class DbQueryDto extends DbQueryBaseDto {
  @IsOptional()
  select?: string[];

  @IsNotEmpty()
  join?: [string, string][] = [];

  @IsNotEmpty()
  where?: [string, { [key: string]: string }][] = [];
}
