import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCustodyAccountDto {
  @ApiPropertyOptional({ description: 'Title of the custody account' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the custody account' })
  @IsOptional()
  @IsString()
  description?: string;
}
