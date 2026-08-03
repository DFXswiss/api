import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * The decision as it is recorded on the limit request itself, plus the context a reader of the report
 * needs months later: what was asked for, what the account was allowed before, and what it is allowed
 * now. The client sends the values it has just written rather than the API re-reading them, so the
 * report states the decision that was taken even if a later decision changes the account again.
 */
export class GenerateLimitRequestPdfDto {
  @IsString()
  decision: string;

  @IsString()
  clerk: string;

  @IsInt()
  @Type(() => Number)
  requestedLimit: number;

  /** The new annual limit, for a decision that grants one. Absent on a rejection. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  grantedLimit?: number;

  /** The annual limit the account had before this decision — what a rejection leaves in force. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  previousLimit?: number;

  @IsOptional()
  @IsString()
  fundOrigin?: string;

  @IsOptional()
  @IsString()
  investmentDate?: string;

  /** The clerk's internal file note ("Interne Aktennotiz" in the sheet). Not shown to the customer. */
  @IsOptional()
  @IsString()
  note?: string;
}
