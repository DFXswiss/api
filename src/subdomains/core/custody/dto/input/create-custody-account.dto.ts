import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustodyAccountDto {
  @ApiProperty({ description: 'Title of the custody account' })
  @IsString()
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({ description: 'Description of the custody account' })
  @IsOptional()
  @IsString()
  description?: string;
}
