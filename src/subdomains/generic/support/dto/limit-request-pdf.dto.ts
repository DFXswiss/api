import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

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

  // @IsNumber, not @IsInt: this is report content, and `user_data.depositLimit` is a float column, so
  // an account carrying a non-integer limit must not make the report — and with it the decision — fail.
  @IsNumber()
  @Type(() => Number)
  requestedLimit: number;

  /**
   * The new annual limit, for a decision that grants one. Absent on a rejection. Integer, because this
   * is the value the caller has just written to `user_data.depositLimit`, whose DTO validates @IsInt.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  grantedLimit?: number;

  /** The annual limit the account had before this decision — what a rejection leaves in force. */
  @IsOptional()
  @IsNumber()
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
