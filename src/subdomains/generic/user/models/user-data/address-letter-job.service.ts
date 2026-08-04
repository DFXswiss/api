import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { LetterService } from 'src/integration/letter/letter.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { LetterColor, LetterMode, LetterShip } from 'src/subdomains/generic/admin/dto/send-letter.dto';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FindOptionsWhere, IsNull, SelectQueryBuilder } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AccountType } from './account-type.enum';
import { AddressLetterOverflowError, AddressLetterPdf, AddressLetterPdfService } from './address-letter-pdf.service';
import { UserData } from './user-data.entity';
import { KycLevel, KycType, UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';

/**
 * Who needs an address verification letter at all — the selection of the automation this job replaces,
 * carried over verbatim: `kycLevel >= 50`, no `letterSentDate`, not an organization account (or no
 * account type at all), a first name, `kycType = DFX`, and not a merged account.
 *
 * Shared by the job and `AddressLetterObserver` on purpose: if the two drifted apart, the observer
 * would report a backlog the job never works on (or hide one it does), which is the exact class of
 * silent failure this replacement exists to end. Expects the query alias `userData`, and is a `where`,
 * not an `andWhere` — call it first.
 *
 * The name is tested for emptiness, not just for NULL: the automation aborted a row on an empty cell,
 * and a blank string would otherwise pass as a valid recipient.
 */
export function applyLetterEligibility(qb: SelectQueryBuilder<UserData>): SelectQueryBuilder<UserData> {
  return qb
    .where('userData.letterSentDate IS NULL')
    .andWhere('userData.kycLevel >= :kycLevel', { kycLevel: KycLevel.LEVEL_50 })
    .andWhere('userData.kycType = :kycType', { kycType: KycType.DFX })
    .andWhere('userData.status != :merged', { merged: UserDataStatus.MERGED })
    .andWhere('(userData.accountType IS NULL OR userData.accountType != :organization)', {
      organization: AccountType.ORGANIZATION,
    })
    .andWhere(`NULLIF(BTRIM(userData.firstname), '') IS NOT NULL`);
}

/**
 * A postal address complete enough to print an envelope from. The automation only ever checked this
 * implicitly (an empty field aborted the row), so an incomplete account looked like an endless
 * candidate. Expects `userData.country` to be joined as `country`.
 *
 * Every part is tested for emptiness rather than for NULL alone: a blank street or city passes an
 * `IS NOT NULL` check, produces an undeliverable envelope, and would still earn an AML proof.
 */
export function applyCompleteAddress(qb: SelectQueryBuilder<UserData>): SelectQueryBuilder<UserData> {
  return qb
    .andWhere(`NULLIF(BTRIM(userData.street), '') IS NOT NULL`)
    .andWhere(`NULLIF(BTRIM(userData.zip), '') IS NOT NULL`)
    .andWhere(`NULLIF(BTRIM(userData.location), '') IS NOT NULL`)
    .andWhere(`NULLIF(BTRIM(country.name), '') IS NOT NULL`);
}

/**
 * The in-memory counterpart of `applyLetterEligibility` + `applyCompleteAddress`, re-evaluated on the
 * row as it stands under the claim.
 *
 * The claim cannot carry these conditions: it has to match on the claim columns alone to stay a valid
 * compare-and-set. Between selecting a candidate and claiming it, an account can be merged, turn into
 * an organization, lose KYC level or have its address emptied - and a letter is irreversible. So the
 * predicate is checked once more on the claimed row, and the two definitions are kept adjacent on
 * purpose: a change to one is meant to be an obvious change to the other.
 */
function isStillEligible(userData: UserData): boolean {
  const { maxFailures } = Config.letter.addressLetter;

  return (
    !userData.letterSentDate &&
    userData.letterFailures < maxFailures &&
    userData.kycLevel >= KycLevel.LEVEL_50 &&
    userData.kycType === KycType.DFX &&
    userData.status !== UserDataStatus.MERGED &&
    userData.accountType !== AccountType.ORGANIZATION &&
    [userData.firstname, userData.street, userData.zip, userData.location, userData.country?.name].every((part) =>
      part?.trim(),
    )
  );
}

/** Thrown when a conditional update finds no row: someone else owns the claim now. */
class ClaimLostError extends Error {
  constructor(userDataId: number) {
    super(`Address letter claim lost for account ${userDataId}`);
  }
}

/**
 * What became of a transition. `LOST` is benign - another worker owns the row, so this run moves on.
 * `FAILED` means the trail could not be written, which is systemic: the run stops rather than change
 * state it cannot account for.
 */
enum TransitionResult {
  APPLIED = 'applied',
  LOST = 'lost',
  FAILED = 'failed',
}

/**
 * Sends the address verification letter that `AmlHelperService` requires (`AmlError.NO_LETTER`) and
 * replaces the spreadsheet automation that used to send them.
 *
 * ## Why the two-field claim
 *
 * That automation ran three calls unconditionally in a row: attach PDF, send letter, set
 * `letterSentDate`. A failing dispatch still stamped the date, so the account counted as served
 * to the AML check although no letter had left the building. Here the order is inverted and
 * conditional: `letterSentDate` is written only after `LetterService.sendLetter` confirmed the job.
 *
 * That alone would allow a double dispatch: a crash between the send and the stamp leaves the account
 * a candidate again, and a physical letter cannot be recalled. `letterClaimDate` closes the gap. It
 * is claimed with a compare-and-set BEFORE the send, and released again ONLY when the attempt
 * provably did not send:
 *
 * | `letterClaimDate` | `letterSentDate` | meaning                                        |
 * | ----------------- | ---------------- | ---------------------------------------------- |
 * | NULL              | NULL             | open candidate                                  |
 * | set               | NULL             | outcome unknown — never retried automatically   |
 * | set               | set              | dispatched, proven                              |
 *
 * The middle state is the deliberate cost of not sending twice: it needs a human, and
 * `AddressLetterObserver.claimedWithoutLetter` is what puts one there.
 *
 * ## Audit trail
 *
 * Releasing a claim clears `letterClaimDate` and overwrites `letterFailures` — a destructive write on
 * mutable snapshot columns. Every such transition is therefore recorded as an append-only
 * `AddressLetterLog` BEFORE the columns change, and the columns stay untouched when that write fails.
 * The dispatch itself is logged too, which is what replaces the archive the automation kept.
 *
 * ## Failure handling
 *
 * `LetterService.sendLetter` distinguishes the two cases by itself: it returns `false` when the
 * provider answered and rejected the job (the letter definitely did not go out — safe to release and
 * retry), and it throws when the HTTP call failed (the provider may well have accepted the job —
 * ambiguous, so the claim stays). `HttpService.post` does not retry internally (`tryCount ?? 1`), so
 * a throw means exactly one unanswered attempt.
 *
 * Retries are bounded by `letterFailures`; the automation retried forever in an unbounded loop.
 * On top of that, the run stops at the first failure of any kind — dispatch, rendering or audit: a
 * provider outage, a broken template or an unavailable audit store would otherwise burn the retry
 * budget of every open candidate within minutes.
 *
 * ## Throughput
 *
 * `Config.letter.addressLetter.batchSize` per run at a ten-minute interval caps the job. Normal load
 * is a few dozen letters a day, so the cap only bites on a backlog — the multi-day outage that
 * prompted this replacement left about a hundred accounts waiting, and that drains in roughly twenty
 * minutes rather than in one uncontrolled burst.
 */
@Injectable()
export class AddressLetterJobService {
  private readonly logger = new DfxLogger(AddressLetterJobService);

  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly addressLetterPdfService: AddressLetterPdfService,
    private readonly letterService: LetterService,
    private readonly kycDocumentService: KycDocumentService,
    private readonly kycFileService: KycFileService,
    private readonly kycLogService: KycLogService,
    private readonly notificationService: NotificationService,
  ) {}

  @DfxCron(CronExpression.EVERY_10_MINUTES, {
    process: Process.ADDRESS_LETTER,
    timeout: 1800,
    scope: CronScope.WORKER,
  })
  async sendAddressLetters(): Promise<void> {
    if (!this.letterService.isConfigured) {
      this.logger.warn('Address letter dispatch skipped: letter service is not configured');
      return;
    }

    const candidates = await this.getCandidates();

    const exhausted: number[] = [];
    const unknown: number[] = [];
    let lastError: string;

    for (const candidate of candidates) {
      const claimedAt = new Date();

      // Claim-first CAS: the cron lock is per process, so the claim - not the lock - is what keeps a
      // second replica from dispatching the same letter. Only an affected row count of 1 wins it.
      const claim = await this.claim(candidate, claimedAt);
      if (claim === TransitionResult.LOST) continue;
      if (claim === TransitionResult.FAILED) break;

      // Re-read under the claim: the candidate list was selected before it, so an address corrected in
      // between would otherwise be printed from the stale row and then stamped as verified.
      const userData = await this.userDataRepo.findOneBy({ id: candidate.id });

      // The claim just matched this row, so it existed a moment ago. Guarded anyway: a null here would
      // throw out of the loop and take the whole run with it, including the escalation below.
      if (!userData) {
        this.logger.error(`Address letter skipped: account ${candidate.id} vanished after it was claimed`);
        continue;
      }

      if (!isStillEligible(userData)) {
        this.logger.info(`Address letter skipped for account ${userData.id}: no longer eligible under its claim`);
        if ((await this.unclaim(userData, claimedAt, 'no longer eligible')) === TransitionResult.FAILED) break;
        continue;
      }

      let pdf: AddressLetterPdf;
      try {
        pdf = await this.addressLetterPdfService.generatePdf({
          userDataId: userData.id,
          name: userData.naturalPersonName,
          street: userData.street,
          houseNumber: userData.houseNumber,
          zip: userData.zip,
          city: userData.location,
          country: userData.country.name,
          date: claimedAt,
        });
      } catch (e) {
        // Nothing was handed over, so the claim is released and the attempt counted.
        lastError = `PDF rendering failed for account ${userData.id}: ${e.message}`;
        this.logger.error(`Address letter PDF failed for account ${userData.id}`, e);
        const stop = await this.countFailure(userData, claimedAt, lastError, exhausted, unknown);
        // An overflowing recipient block is this account's data, not a broken template, so the run
        // carries on. Anything else renders the same way for everyone and is treated as systemic:
        // continuing would spend every remaining candidate's retry budget on the same fault.
        if (stop || !(e instanceof AddressLetterOverflowError)) break;
        continue;
      }

      if (pdf.pageCount !== 1)
        this.logger.warn(`Address letter for account ${userData.id} rendered ${pdf.pageCount} pages, expected 1`);

      let sent: boolean;
      try {
        sent = await this.letterService.sendLetter({
          data: pdf.base64,
          page: pdf.pageCount,
          color: LetterColor.COLOR,
          mode: LetterMode.SIMPLEX,
          ship: Config.letter.addressLetter.nationalCountries.includes(userData.country.symbol?.toUpperCase())
            ? LetterShip.NATIONAL
            : LetterShip.INTERNATIONAL,
        });
      } catch (e) {
        // Ambiguous: the provider may have accepted the job. The claim stays so no second letter can
        // ever follow from this account, and a human decides from the provider's side.
        lastError = `Letter dispatch did not answer for account ${userData.id}: ${e.message}`;
        this.logger.critical(`Address letter dispatch unanswered for account ${userData.id}`, e);
        unknown.push(userData.id);
        break;
      }

      if (!sent) {
        lastError = `Letter provider rejected the job for account ${userData.id}`;
        this.logger.error(lastError);
        await this.countFailure(userData, claimedAt, lastError, exhausted, unknown);
        break;
      }

      // The AML proof, and only now: everything above can still fail without a letter existing,
      // everything below cannot undo one that does. Record and stamp in one transaction, so the trail
      // and the proof can never disagree about whether this letter went out.
      const sentAt = new Date();
      if (!(await this.stampProof(userData, claimedAt, sentAt))) {
        lastError = `Address letter sent but not stamped for account ${userData.id}`;
        unknown.push(userData.id);
        break;
      }

      await this.attachKycFile(userData, pdf.base64, sentAt);
    }

    await this.escalate(exhausted, unknown, lastError);
  }

  // *** HELPER METHODS *** //

  /**
   * Open candidates, filtered exactly like the automation this job replaces (see
   * `applyLetterEligibility`), plus what that one only ever checked implicitly: a postal address
   * complete enough to print. An account missing part of its address is never claimed and never
   * retried — it is counted separately by `AddressLetterObserver` so it cannot masquerade as a stuck
   * backlog.
   */
  private async getCandidates(): Promise<UserData[]> {
    const { batchSize, maxFailures } = Config.letter.addressLetter;
    const query = this.userDataRepo.createQueryBuilder('userData').innerJoinAndSelect('userData.country', 'country');

    return applyCompleteAddress(applyLetterEligibility(query))
      .andWhere('userData.letterClaimDate IS NULL')
      .andWhere('userData.letterFailures < :maxFailures', { maxFailures })
      .orderBy('userData.id', 'ASC')
      .take(batchSize)
      .getMany();
  }

  /**
   * Writes the immutable event and the state change it describes in ONE transaction, so the trail can
   * never claim a transition that did not happen (nor a transition go unrecorded).
   *
   * Every criteria carries `letterClaimDate: claimedAt`, i.e. proof that this attempt still owns the
   * claim. Without it a stalled attempt could, on resuming, clear a claim that a later attempt has
   * meanwhile taken - and two workers dispatching the same account is the one outcome that cannot be
   * undone. Comparing against the timestamp this run wrote itself is safe: it is the same value that
   * went into the column, not one read back at a different precision.
   *
   * Returns false when nothing was changed, distinguishing a lost claim (benign, someone else owns it)
   * from an unusable audit store (systemic, the caller stops the run).
   */
  private async recordTransition(
    userData: UserData,
    criteria: FindOptionsWhere<UserData>,
    values: QueryDeepPartialEntity<UserData>,
    result: string,
    comment: string,
  ): Promise<TransitionResult> {
    try {
      await this.userDataRepo.manager.transaction(async (manager) => {
        await this.kycLogService.createAddressLetterLog(userData, result, comment, manager);

        const update = await manager
          .getRepository(UserData)
          .update({ id: userData.id, letterSentDate: IsNull(), ...criteria }, values);
        // Rolls the event back with it: an event describing a transition that did not happen is worse
        // than no event at all.
        if (!update.affected) throw new ClaimLostError(userData.id);
      });

      return TransitionResult.APPLIED;
    } catch (e) {
      if (e instanceof ClaimLostError) {
        this.logger.warn(e.message);
        return TransitionResult.LOST;
      }

      this.logger.critical(`Address letter audit write failed for account ${userData.id}`, e);
      return TransitionResult.FAILED;
    }
  }

  /**
   * Claims the account and records the attempt in the same transaction.
   *
   * The claim writes a NULL column, so nothing is overwritten - but it is the only trace an attempt
   * leaves when the dispatch then goes unanswered, and that is exactly the state someone has to
   * investigate. Recording it makes the trail cover every attempt, not only the ones that resolved.
   */
  private async claim(userData: UserData, claimedAt: Date): Promise<TransitionResult> {
    return this.recordTransition(
      userData,
      { letterClaimDate: IsNull() },
      { letterClaimDate: claimedAt },
      `claimed: claimDate null -> ${claimedAt.toISOString()}`,
      `attempt ${userData.letterFailures + 1}`,
    );
  }

  /**
   * Counts a provably failed attempt and releases the claim. Returns true when the caller must stop:
   * either the trail could not be written or the claim was lost, and in both cases the columns were
   * deliberately left untouched.
   */
  private async countFailure(
    userData: UserData,
    claimedAt: Date,
    reason: string,
    exhausted: number[],
    unknown: number[],
  ): Promise<boolean> {
    const { maxFailures } = Config.letter.addressLetter;
    const failures = userData.letterFailures + 1;

    const released = await this.recordTransition(
      userData,
      { letterClaimDate: claimedAt, letterFailures: userData.letterFailures },
      { letterClaimDate: null, letterFailures: failures },
      `dispatch failed: claimDate ${claimedAt.toISOString()} -> null, failures ${userData.letterFailures} -> ${failures}`,
      reason,
    );

    if (released !== TransitionResult.APPLIED) {
      unknown.push(userData.id);
      return true;
    }

    // Only a release that actually took effect may report exhaustion - otherwise the alert names an
    // account whose counter someone else owns.
    if (failures >= maxFailures) exhausted.push(userData.id);

    return false;
  }

  /**
   * Releases a claim for an account that turned out not to be dispatchable, without counting a failed
   * attempt — nothing was sent and nothing was wrong with the dispatch. Returns false when the claim
   * was left in place, in which case the caller stops.
   */
  private async unclaim(userData: UserData, claimedAt: Date, reason: string): Promise<TransitionResult> {
    return this.recordTransition(
      userData,
      { letterClaimDate: claimedAt },
      { letterClaimDate: null },
      `claim released: claimDate ${claimedAt.toISOString()} -> null`,
      reason,
    );
  }

  /** Records the dispatch and stamps the AML proof in one transaction, under this attempt's claim. */
  private async stampProof(userData: UserData, claimedAt: Date, sentAt: Date): Promise<boolean> {
    const stamped = await this.recordTransition(
      userData,
      { letterClaimDate: claimedAt },
      { letterSentDate: sentAt },
      `dispatched: letterSentDate null -> ${sentAt.toISOString()}`,
      `claimed ${claimedAt.toISOString()}`,
    );

    // The letter is already out. A missing stamp leaves the claim standing, which is the honest state:
    // the observer reports it as an unknown outcome and a human reconciles it with the provider.
    if (stamped !== TransitionResult.APPLIED)
      this.logger.critical(`Address letter dispatched for account ${userData.id} but the proof was not stamped`);

    return stamped === TransitionResult.APPLIED;
  }

  /**
   * Attaches the dispatched letter as a KYC document, mirroring what the previous automation uploaded
   * (`UserNotes`/`PostDispatch`). Deliberately after the dispatch and deliberately not rolled back: the
   * letter is already on its way, so a failing upload must not revoke the AML proof. It is reported
   * instead — `AddressLetterObserver.sentWithoutFile` counts exactly this case.
   */
  private async attachKycFile(userData: UserData, base64: string, date: Date): Promise<void> {
    // The lower-case `postversand` is load-bearing, not decoration: the compliance report
    // "Überprüfung der Wohnsitzadresse" (`Config.kyc.fileDownloadConfig` id 10) collects these letters with
    // `file.name.includes('postversand')`, case-sensitively, over the same `user/<id>/UserNotes` prefix
    // this upload writes to. A name in any other spelling uploads fine and disappears from the report.
    const name = `${Util.filenameDate(date)}-postversand-${userData.id}.pdf`;

    try {
      const { file } = await this.kycDocumentService.uploadUserFile(
        userData,
        FileType.USER_NOTES,
        name,
        Buffer.from(base64, 'base64'),
        ContentType.PDF,
        true,
        undefined,
        FileSubType.POST_DISPATCH,
        { document: 'AddressLetter', creationTime: date.toISOString(), fileName: name },
      );

      this.logger.info(`Address letter document stored for account ${userData.id}: ${name} (file ${file.id})`);
      await this.logDocument(userData, `document stored: file ${file.id} (${name})`);
    } catch (e) {
      this.logger.error(`Address letter file upload failed for account ${userData.id} after dispatch`, e);
      // `uploadUserFile` writes the row before the blob, so a failed storage upload leaves a valid row
      // without a blob behind. Left alone, the observer's anti-join would count the document as present
      // and `sentWithoutFile` would stay silent about the very case it exists for.
      await this.invalidateOrphanFile(userData, name, e.message);
      await this.logDocument(userData, `document upload failed: ${e.message}`);
    }
  }

  /**
   * The document outcome, for the record. Best effort on purpose: the letter and its proof are already
   * durable at this point, and a missing note about the document must not fail anything.
   */
  private async logDocument(userData: UserData, detail: string): Promise<void> {
    await this.kycLogService
      .createAddressLetterLog(userData, detail)
      .catch((e) => this.logger.error(`Address letter document log failed for account ${userData.id}`, e));
  }

  /**
   * Marks the row a failed upload left behind as invalid, recording the transition first: `valid` is a
   * mutable snapshot column, and `true -> false` would otherwise be an overwrite with no recoverable
   * previous value. Log and update share one transaction, and the log names the file it describes.
   */
  private async invalidateOrphanFile(userData: UserData, name: string, reason: string): Promise<void> {
    const files = await this.kycFileService
      .getUserDataKycFiles(userData.id)
      .catch(() => [] as { id: number; name: string }[]);
    const orphan = files.find((f) => f.name === name);
    if (!orphan) return;

    await this.userDataRepo.manager
      .transaction(async (manager) => {
        await this.kycLogService.createAddressLetterLog(
          userData,
          `document invalidated: file ${orphan.id} valid true -> false`,
          reason,
          manager,
          orphan.id,
        );
        await this.kycFileService.invalidateKycFile(orphan.id, manager);
      })
      // only once the row is committed - dropping the cache earlier lets a concurrent read refill it
      // with the still-valid row
      .then(() => this.kycFileService.invalidateKycFileCache())
      .catch((e) => this.logger.error(`Address letter orphan invalidation failed for file ${orphan.id}`, e));
  }

  /**
   * Threshold escalation over the run: a single failed attempt is retried and stays quiet, an account
   * that ran out of retries or whose dispatch went unanswered raises the operator alert. The counter
   * behind the threshold is `letterFailures` on the account, so it survives a restart.
   *
   * `suppressRecurring` without `debounce`: `Notification.isSuppressed` evaluates
   * `suppressRecurring || isDebounced`, so combining both would silence the alert forever.
   */
  private async escalate(exhausted: number[], unknown: number[], lastError?: string): Promise<void> {
    if (!exhausted.length && !unknown.length) return;

    const { maxFailures } = Config.letter.addressLetter;
    const ids = [...exhausted, ...unknown].sort((a, b) => a - b);
    const errors = [
      exhausted.length ? `Retries exhausted (${maxFailures}) for account(s) ${exhausted.join(', ')}` : undefined,
      unknown.length ? `Dispatch outcome unknown, claim kept for account(s) ${unknown.join(', ')}` : undefined,
      lastError,
    ].filter((e) => e);

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: { subject: `Address letter dispatch failed: account(s) ${ids.join(', ')}`, errors },
      options: { suppressRecurring: true },
      correlationId: `AddressLetterDispatch&${ids.join('-')}`,
    });
  }
}
