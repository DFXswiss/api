import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DebugQueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(10000)
  sql: string;
}
