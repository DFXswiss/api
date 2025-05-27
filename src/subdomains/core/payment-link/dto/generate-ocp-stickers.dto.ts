import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GenerateOcpStickersDto {
  @ApiProperty({ description: 'Route ID or label' })
  @IsNotEmpty()
  @IsString()
  route: string;

  @ApiProperty({ description: 'Comma-separated external IDs' })
  @IsNotEmpty()
  @IsString()
  externalIds: string;
}
