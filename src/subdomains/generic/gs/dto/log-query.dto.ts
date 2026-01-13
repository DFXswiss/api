import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export enum LogQueryTemplate {
  TRACES_BY_OPERATION = 'traces-by-operation',
  TRACES_BY_MESSAGE = 'traces-by-message',
  EXCEPTIONS_RECENT = 'exceptions-recent',
  REQUEST_FAILURES = 'request-failures',
  DEPENDENCIES_SLOW = 'dependencies-slow',
  CUSTOM_EVENTS = 'custom-events',
}

export class LogQueryDto {
  @IsEnum(LogQueryTemplate)
  template: LogQueryTemplate;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9-]{36}$/i, { message: 'operationId must be a valid GUID' })
  operationId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_\-.: ()]{1,100}$/, {
    message: 'messageFilter must be alphanumeric with basic punctuation (max 100 chars)',
  })
  messageFilter?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168) // max 7 days
  hours?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(5000)
  durationMs?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{1,50}$/, { message: 'eventName must be alphanumeric' })
  eventName?: string;
}

export class LogQueryResult {
  columns: { name: string; type: string }[];
  rows: unknown[][];
}
