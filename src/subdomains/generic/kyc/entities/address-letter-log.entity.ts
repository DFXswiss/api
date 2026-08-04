import { ChildEntity } from 'typeorm';
import { KycLog } from './kyc-log.entity';

/**
 * Append-only trail of every address letter dispatch attempt, written by `AddressLetterJobService`
 * before it changes the dispatch state on the account.
 *
 * It exists because `letterClaimDate` and `letterFailures` are mutable snapshot columns: the claim is
 * cleared again on a failed attempt and the counter is overwritten, so without this row neither the
 * previous value nor the reason would be reconstructible from the database. It is also the trail that
 * replaces the archive the spreadsheet automation kept.
 */
@ChildEntity()
export class AddressLetterLog extends KycLog {}
