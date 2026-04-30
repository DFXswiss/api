import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CommandDto {
  @IsNotEmpty()
  @IsString()
  command: string;

  @IsOptional()
  @IsBoolean()
  noAutoUnlock?: boolean;
}
