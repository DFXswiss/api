import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FileSubType, FileType } from './kyc-file.dto';

export enum LegacyFileSkipReason {
  INVALID_PATH = 'InvalidPath',
  UNSUPPORTED_EXTENSION = 'UnsupportedExtension',
  SUPERSEDED_NAME_CHECK = 'SupersededNameCheck',
  UNKNOWN_OWNER = 'UnknownOwner',
  ALREADY_CATALOGED = 'AlreadyCataloged',
}

export interface LegacyFileEntry {
  userDataId: number;
  name: string;
  type: FileType;
  subType?: FileSubType;
  path: string;
}

export interface LegacyFileMapping {
  entries: LegacyFileEntry[];
  skipped: LegacyFileSkipReason[];
}

export class LegacyFileTypeCountDto {
  @ApiProperty({ enum: FileType })
  type: FileType;

  @ApiPropertyOptional({ enum: FileSubType })
  subType?: FileSubType;

  @ApiProperty()
  count: number;
}

export class LegacyFileSkipCountDto {
  @ApiProperty({ enum: LegacyFileSkipReason })
  reason: LegacyFileSkipReason;

  @ApiProperty()
  count: number;
}

export class LegacyFileExampleDto {
  @ApiProperty()
  userDataId: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: FileType })
  type: FileType;

  @ApiPropertyOptional({ enum: FileSubType })
  subType?: FileSubType;

  @ApiProperty()
  path: string;
}

export class LegacyFileSyncDto {
  @ApiProperty({ description: 'No row was written when true' })
  dryRun: boolean;

  @ApiProperty({ description: 'Spider owners (user data) seen in the storage listing' })
  owners: number;

  @ApiProperty({ description: 'Blob keys seen in the storage listing' })
  keys: number;

  @ApiProperty({ description: 'Rows written, always 0 on a dry run' })
  inserted: number;

  @ApiProperty({ description: 'Rows a non-dry run would write' })
  wouldInsert: number;

  @ApiProperty({ type: LegacyFileTypeCountDto, isArray: true })
  byType: LegacyFileTypeCountDto[];

  @ApiProperty({ type: LegacyFileSkipCountDto, isArray: true })
  skipped: LegacyFileSkipCountDto[];

  @ApiProperty({ type: LegacyFileExampleDto, isArray: true })
  examples: LegacyFileExampleDto[];
}
