import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ComplianceSearchType } from 'src/subdomains/generic/support/dto/user-data-support.dto';

export class DebugUserQueryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(256)
  mail: string;
}

// Mirrors the compliance search result shape, but exposes only non-PII userDataIds.
export interface DebugUserResult {
  type: ComplianceSearchType;
  userDataIds: number[];
}
