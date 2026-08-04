import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { LetterService } from 'src/integration/letter/letter.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { LetterColor, LetterMode, LetterShip } from 'src/subdomains/generic/admin/dto/send-letter.dto';
import { FileSubType, FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { ContentType } from 'src/subdomains/generic/kyc/enums/content-type.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { IsNull, SelectQueryBuilder } from 'typeorm';
import { AccountType } from './account-type.enum';
import { AddressLetterPdf, AddressLetterPdfService } from './address-letter-pdf.service';
import { UserData } from './user-data.entity';
import { KycLevel, KycType, UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';

/** Countries the dispatch provider bills as a national shipment. */
export const NATIONAL_LETTER_COUNTRIES = ['DE'];

/** Failed attempts after which an account stops being retried and is escalated instead. */
export const MAX_LETTER_FAILURES = 3;

/** Accounts served per run — see the class doc on why the throughput is bounded. */
export const LETTER_BATCH_SIZE = 10;

/**
 * Who needs an address verification letter at all — the selection of the automation this job replaces,
 * carried over verbatim: `kycLevel >= 50`, no `letterSentDate`, not an organization account (or no
 * account type at all), a first name, `kycType = DFX`, and not a merged account.
 *
 * Shared by the job and `AddressLetterObserver` on purpose: if the two drifted apart, the observer
 * would report a backlog the job never works on (or hide one it does), which is the exact class of
 * silent failure this replacement exists to end. Expects the query alias `userData`, and is a `where`,
 * not an `andWhere` — call it first.
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
    .andWhere('userData.firstname IS NOT NULL');
}

/**
 * A postal address complete enough to print an envelope from. The automation only ever checked this
 * implicitly (an empty field aborted the row), so an incomplete account looked like an endless
 * candidate. Expects `userData.country` to be joined as `country`.
 */
export function applyCompleteAddress(qb: SelectQueryBuilder<UserData>): SelectQueryBuilder<UserData> {
  return qb
    .andWhere('userData.street IS NOT NULL')
    .andWhere('userData.zip IS NOT NULL')
    .andWhere('userData.location IS NOT NULL')
    .andWhere('country.id IS NOT NULL');
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
 * ## Failure handling
 *
 * `LetterService.sendLetter` distinguishes the two cases by itself: it returns `false` when the
 * provider answered and rejected the job (the letter definitely did not go out — safe to release and
 * retry), and it throws when the HTTP call failed (the provider may well have accepted the job —
 * ambiguous, so the claim stays). `HttpService.post` does not retry internally (`tryCount ?? 1`), so
 * a throw means exactly one unanswered attempt.
 *
 * Retries are bounded by `letterFailures`; the automation retried forever in an unbounded loop.
 * On top of that, the run stops at the first send failure of any kind: a provider outage or an empty
 * balance would otherwise burn the retry budget of every open candidate within minutes.
 *
 * ## Throughput
 *
 * `LETTER_BATCH_SIZE` per run at a ten-minute interval caps the job at 60 letters an hour. Normal load
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

    for (const userData of candidates) {
      const now = new Date();

      // Claim-first CAS: the cron lock is per process, so the claim - not the lock - is what keeps a
      // second replica from dispatching the same letter. Only an affected row count of 1 wins it.
      const claim = await this.userDataRepo.update(
        { id: userData.id, letterSentDate: IsNull(), letterClaimDate: IsNull() },
        { letterClaimDate: now },
      );
      if (!claim.affected) continue;

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
          date: now,
        });
      } catch (e) {
        // Nothing was handed over, so the claim is released and the attempt counted. Counting it
        // matters: a document that fails to render fails to render again next run.
        lastError = `PDF rendering failed for account ${userData.id}: ${e.message}`;
        this.logger.error(`Address letter PDF failed for account ${userData.id}`, e);
        if (await this.releaseClaim(userData)) exhausted.push(userData.id);
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
          ship: NATIONAL_LETTER_COUNTRIES.includes(userData.country.symbol?.toUpperCase())
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
        if (await this.releaseClaim(userData)) exhausted.push(userData.id);
        break;
      }

      // The AML proof, and only now: everything above can still fail without a letter existing,
      // everything below cannot undo one that does.
      await this.userDataRepo.update({ id: userData.id, letterSentDate: IsNull() }, { letterSentDate: now });

      await this.attachKycFile(userData, pdf.base64, now);
    }

    await this.escalate(exhausted, unknown, lastError);
  }

  // *** HELPER METHODS *** //

  /**
   * Open candidates, filtered exactly like the automation this job replaces (see
   * `applyLetterEligibility`), plus what that one only ever checked implicitly: a postal address
   * complete enough to print. An account missing part of its address is
   * never claimed and never retried — it is counted separately by `AddressLetterObserver` so it
   * cannot masquerade as a stuck backlog.
   */
  private async getCandidates(): Promise<UserData[]> {
    const query = this.userDataRepo.createQueryBuilder('userData').innerJoinAndSelect('userData.country', 'country');

    return applyCompleteAddress(applyLetterEligibility(query))
      .andWhere('userData.letterClaimDate IS NULL')
      .andWhere('userData.letterFailures < :maxFailures', { maxFailures: MAX_LETTER_FAILURES })
      .orderBy('userData.id', 'ASC')
      .take(LETTER_BATCH_SIZE)
      .getMany();
  }

  /** Releases the claim of an attempt that provably did not send. Returns true if the retries ran out. */
  private async releaseClaim(userData: UserData): Promise<boolean> {
    const failures = userData.letterFailures + 1;
    await this.userDataRepo.update({ id: userData.id }, { letterClaimDate: null, letterFailures: failures });
    return failures >= MAX_LETTER_FAILURES;
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

      // de-facto audit trail, replacing the archive the previous automation kept
      this.logger.info(`Address letter sent for account ${userData.id}: ${name} (file ${file.id})`);
    } catch (e) {
      this.logger.error(`Address letter file upload failed for account ${userData.id} after dispatch`, e);
    }
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

    const ids = [...exhausted, ...unknown].sort((a, b) => a - b);
    const errors = [
      exhausted.length
        ? `Retries exhausted (${MAX_LETTER_FAILURES}) for account(s) ${exhausted.join(', ')}`
        : undefined,
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
