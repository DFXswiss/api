import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { FileSubType, FileType } from './kyc-file.dto';

// Postgres int4 upper bound. An account id is an int4, so anything above it is not one — and feeding it
// into a query against that column makes Postgres 500 the request (22003) instead of returning nothing.
export const MaxDbId = 2147483647;

// Storage allows a blob key of up to 1024 characters, and `kyc_file.path` is sized to match. The two
// numbers must stay equal: a key that does not fit the column can only be rejected, never stored.
export const MaxPathLength = 1024;

export enum LegacyFileSkipReason {
  INVALID_PATH = 'InvalidPath',
  UNSUPPORTED_EXTENSION = 'UnsupportedExtension',
  PATH_TOO_LONG = 'PathTooLong',
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
  // The document's own date, read from the path where it carries one; see KycLegacyFileMapper.pathDate.
  date?: Date;
}

export interface LegacyFileMapping {
  entries: LegacyFileEntry[];
  skipped: LegacyFileSkipReason[];
}

export class SyncLegacyFilesQueryDto {
  // Everything except an explicit 'false' is a dry run: the write path is entered on request, never by
  // a typo or a value the client did not mean.
  @ApiPropertyOptional({ description: "Pass 'false' to write the rows; any other value is a dry run" })
  @IsOptional()
  @IsString()
  dryRun?: string;

  // Restricts the run to one account. Validated rather than coerced: a value that is not an account id
  // must fail the request, because falling back to "no restriction" would turn a single-account test
  // into a run over every account.
  @ApiPropertyOptional({ description: 'Restrict the run to a single account' })
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : +value))
  @IsInt()
  @Min(1)
  // Same 22003 class as the other id query parameters: the value is matched against an int4 column, so a
  // value above int4 max makes Postgres 500 the whole request.
  @Max(MaxDbId)
  userDataId?: number;
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

  @ApiPropertyOptional({ description: 'Document date read from the storage path' })
  date?: Date;
}

/**
 * Where the date of the written rows came from, and what range they cover.
 *
 * Reported because the catalog row stands in for the document: a run that dated everything by the
 * store (`fromListing`) or by nothing (`fromDefault`) produces rows that all look equally recent,
 * which is visible here and nowhere else.
 */
export class LegacyFileDateSourceDto {
  @ApiProperty({ description: 'Rows dated by the epoch segment of their storage path' })
  fromPath: number;

  @ApiProperty({ description: 'Rows dated by the date the store reports for the object' })
  fromListing: number;

  @ApiProperty({ description: 'Rows left to the column default, i.e. stamped with the run' })
  fromDefault: number;

  @ApiPropertyOptional({ description: 'Oldest date written' })
  oldest?: Date;

  @ApiPropertyOptional({ description: 'Newest date written' })
  newest?: Date;
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

  @ApiProperty({ type: LegacyFileDateSourceDto })
  dated: LegacyFileDateSourceDto;
}
