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

/**
 * The opt-out decision itself, so the controller and its test read the same expression rather than
 * each restating it — a duplicated `!== 'false'` is exactly the kind of thing that drifts silently
 * into a live write.
 *
 * A free function rather than a getter on the DTO: the global ValidationPipe runs without
 * `transform: true` (see `main.ts`), so the handler receives a plain object and any accessor
 * declared on the class would be `undefined` at runtime — which, being falsy, would read as
 * "not a dry run" and start writing.
 */
export const isDryRun = (query: KycFileIdBackfillQuery): boolean => query.dryRun !== 'false';

export class BackfillStartResult {
  started: boolean;
  dryRun: boolean;
  message: string;
}
