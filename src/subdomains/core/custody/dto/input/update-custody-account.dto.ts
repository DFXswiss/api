import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCustodyAccountDto {
  @ApiPropertyOptional({ description: 'Title of the CustodyAccount' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({ description: 'Description of the CustodyAccount' })
  @IsOptional()
  @IsString()
  description?: string;
}
