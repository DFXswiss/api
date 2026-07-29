import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { GsTriggerType } from 'src/subdomains/generic/gs/dto/gs-trigger-type.enum';

export class DbQueryBaseDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
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
  @MaxLength(256)
  identifier: string;

  // Enforcement of "trigger is required" happens in the controller, gated by the
  // `gsTriggerEnforcement` setting (default-off) — not here — keeping this optional at the DTO
  // level lets the requirement roll out gradually.
  @IsOptional()
  @IsEnum(GsTriggerType)
  trigger?: GsTriggerType;
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
