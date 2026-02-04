import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

export class DownloadUserDataDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsArray()
  userDataIds: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  checkOnly?: boolean;
}
