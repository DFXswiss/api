import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobGroup, JobStatus } from '../enums';

export class JobDto {
  @ApiProperty()
  uid: string;

  @ApiProperty({ enum: JobGroup })
  group: JobGroup;

  @ApiProperty({ enum: JobStatus })
  status: JobStatus;

  @ApiProperty()
  created: Date;

  @ApiPropertyOptional()
  started?: Date;

  @ApiPropertyOptional()
  finished?: Date;

  @ApiProperty()
  expectedSeconds: number;

  @ApiPropertyOptional()
  result?: unknown;

  @ApiPropertyOptional()
  error?: string;
}
