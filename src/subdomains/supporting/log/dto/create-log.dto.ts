import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { LogSeverity } from '../log.entity';

export class CreateLogDto {
  @IsNotEmpty()
  @IsString()
  system: string;

  @IsNotEmpty()
  @IsString()
  subsystem: string;

  @IsNotEmpty()
  @IsEnum(LogSeverity)
  severity: LogSeverity;

  @IsNotEmpty()
  @IsString()
  message: string;
}
