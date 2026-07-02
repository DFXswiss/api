import { IsIn, IsOptional } from 'class-validator';

export class KycFileIdBackfillQuery {
  /**
   * Fail-closed: omitting the parameter dry-runs, and only the exact string `false` starts a live
   * write. Anything else — `TRUE`, `1`, a typo, or a bare `?dryRun` (Express yields `''`) — is
   * rejected with a 400 rather than silently falling through to writing.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  dryRun?: 'true' | 'false';
}
