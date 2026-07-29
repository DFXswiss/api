import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { GsTriggerType } from 'src/subdomains/generic/gs/dto/gs-trigger-type.enum';

export class DbQueryBaseDto {
  // The character class rejects control characters at the edge, so they can never reach a
  // Postgres error, a stack trace or any log line that bypasses `Util.sanitizeLogValue` —
  // `table` is interpolated into the query builder, so its value can surface in DB errors.
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_]+$/)
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

  // Same reasoning as `table`: keep control characters out at the edge, since this value is
  // logged on every call and also reaches log lines that do not run through the sanitizer.
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/)
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
