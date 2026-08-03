import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import {
  FundOrigin,
  InvestmentDate,
  LimitRequestDecision,
} from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';

/**
 * The decision as it is recorded on the limit request itself, plus the context a reader of the report
 * needs months later: what was asked for, what the account was allowed before, and what it is allowed
 * now. The client sends the values it has just written rather than the API re-reading them, so the
 * report states the decision that was taken even if a later decision changes the account again.
 */
export class GenerateLimitRequestPdfDto {
  @ApiProperty({ enum: LimitRequestDecision, description: 'Decision recorded on the limit request' })
  @IsEnum(LimitRequestDecision)
  decision: LimitRequestDecision;

  @ApiProperty({ description: 'Clerk who processed the limit request' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trim)
  @MaxLength(100)
  clerk: string;

  // `requestedLimit` mirrors `limit_request.limit`, an integer column; the write DTO for that column
  // validates @IsInt, so this report field validates the same way — a value that could never have been
  // written must not make it into the report either. Unlike previousLimit below, this is not a float
  // column, so there is no reason to relax it.
  @ApiProperty({ description: 'Requested annual limit (mirrors limit_request.limit)' })
  @IsInt()
  requestedLimit: number;

  /**
   * The new annual limit, for a decision that grants one. Absent on a rejection. Integer, because this
   * is the value the caller has just written to `user_data.depositLimit`, whose DTO validates @IsInt.
   */
  @ApiPropertyOptional({
    description: 'The new annual limit, for a decision that grants one. Absent on a rejection.',
  })
  @IsOptional()
  @IsInt()
  grantedLimit?: number;

  /**
   * The annual limit the account had before this decision — what a rejection leaves in force. `@IsNumber`,
   * not `@IsInt`: `user_data.depositLimit` is a float column, so an account carrying a non-integer limit
   * must not make the report — and with it the decision — fail.
   */
  @ApiPropertyOptional({
    description: 'The annual limit the account had before this decision — what a rejection leaves in force.',
  })
  @IsOptional()
  @IsNumber()
  previousLimit?: number;

  @ApiPropertyOptional({ enum: FundOrigin, description: 'Origin of the funds, as recorded on the limit request' })
  @IsOptional()
  @IsEnum(FundOrigin)
  fundOrigin?: FundOrigin;

  @ApiPropertyOptional({ enum: InvestmentDate, description: 'Planned investment timing, as recorded on the limit request' })
  @IsOptional()
  @IsEnum(InvestmentDate)
  investmentDate?: InvestmentDate;

  /** The clerk's internal file note ("Interne Aktennotiz" in the sheet). Not shown to the customer. */
  @ApiPropertyOptional({
    description: 'The clerk\'s internal file note ("Interne Aktennotiz" in the sheet). Not shown to the customer.',
  })
  @IsOptional()
  @IsString()
  @Transform(Util.trim)
  note?: string;
}
