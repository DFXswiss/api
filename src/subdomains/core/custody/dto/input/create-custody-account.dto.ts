import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustodyAccountDto {
  @ApiProperty({ description: 'Title of the CustodyAccount' })
  @IsString()
  @MaxLength(256)
  title: string;

  @ApiPropertyOptional({ description: 'Description of the CustodyAccount' })
  @IsOptional()
  @IsString()
  description?: string;
}
