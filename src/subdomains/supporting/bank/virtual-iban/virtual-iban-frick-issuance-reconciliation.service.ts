import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FrickVirtualIbansFetchResult } from 'src/integration/bank/services/frick.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { FrickVibanProvider } from 'src/subdomains/supporting/bank/virtual-iban/providers/frick-viban.provider';
import { VirtualIbanIssuanceEvent } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-event.entity';
import {
  VirtualIbanIssuanceIntent,
  VirtualIbanIssuanceIntentStatus,
} from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent.entity';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { DataSource, In, Like } from 'typeorm';
import {
  CREATE_PATH_REFERENCE_MARKER,
  MERGE_SUPERSEDED_MARKER,
  RECOVERY_PATH_REFERENCE_MARKER,
  VirtualIbanService,
} from './virtual-iban.service';

interface AbandonedReferenceHit {
  abandonedReference: string;
  eventId: number;
  intentId: number;
  userDataId: number;
  currencyId: number;
  bankId: number;
  created: Date;
}

/**
 * Fixed-vocabulary reason only — never free-text from nextError.
 * Sole remaining unresolved path: query matched a marker substring, but the value after the marker
 * is empty (unextractable). `nextError IS NULL` cannot appear here — SQL `NULL LIKE pattern` is
 * never true, so the productive find() never returns null nextError rows.
 */
type UnresolvedAbandonedReferenceReason = 'reference_unextractable';

interface UnresolvedAbandonedReferenceCandidate {
  eventId: number;
  intentId: number;
  userDataId: number;
  currencyId: number;
  bankId: number;
  created: Date;
  reason: UnresolvedAbandonedReferenceReason;
}

interface StuckIntentListingMatch {
  intentId: number;
  requestReference: string;
  userDataId: number;
  currencyId: number;
  bankId: number;
  status: VirtualIbanIssuanceIntentStatus;
  updated: Date;
}

interface UnprovenAbsenceIntent {
  intentId: number;
  userDataId: number;
  currencyId: number;
  bankId: number;
  status: VirtualIbanIssuanceIntentStatus;
  updated: Date;
  listingStartedAt: Date;
  latestPossibleCreateProcessedAt: Date;
}

interface AutomaticRetryRiskIntent extends UnprovenAbsenceIntent {
  requestReference: string;
}

/**
 * Periodic Frick issuance reconciliation:
 * - Phase 1: reopen stuck InFlight/Failed intents only on the strongest available bank evidence:
 *   an all-state, fully validated empty listing begun after the latest possible create-processing
 *   time. Listing absence is not authoritative, so every reset is preceded by an operator alert.
 *   (sole caller of {@link VirtualIbanService.resetStuckFrickIntentForReconciliationOnly}).
 * - Phase 2: alert-only check for delayed Frick vIBANs under retired issuance references.
 */
@Injectable()
export class VirtualIbanFrickIssuanceReconciliationService {
  private readonly logger = new DfxLogger(VirtualIbanFrickIssuanceReconciliationService);

  /**
   * Minimum age of an InFlight/Failed Frick intent before Phase 1 may reopen it.
   *
   * Derivation from BankFrickService.HTTP_TIMEOUT_MS = 30_000:
   * - create call worst case = 90s: original request (30s) + /authorize re-auth after 401 (30s) +
   *   one-shot retried request (30s). requestSigned has no further internal retry loop beyond that.
   * - activate call: same shape, another 90s
   * - worst-case in-flight window therefore 180s
   * - ×10 safety multiplier (job is hourly; being generous costs nothing) → 1_800_000 ms (30 min)
   */
  static readonly FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS = 1_800_000;
  static readonly FRICK_CREATE_MAX_PROCESSING_MS = VirtualIbanService.FRICK_CREATE_MAX_PROCESSING_MS;

  constructor(
    private readonly dataSource: DataSource,
    private readonly frickVibanProvider: FrickVibanProvider,
    private readonly bankService: BankService,
    private readonly notificationService: NotificationService,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  /**
   * `timeout: 1800` is a LockClass resumption threshold (src/shared/utils/lock.ts), not a hard abort
   * of a still-running previous tick: a run older than 1800s no longer blocks a new hour-tick from
   * starting, so two overlapping invocations are possible. Phase-1 reset stays safe under overlap by
   * construction: {@link VirtualIbanService.resetStuckFrickIntentForReconciliationOnly} wraps the
   * write in a per-row pessimistic_write transaction that re-checks requestReference under lock,
   * serializes concurrent attempts on the same intent row, and no-ops the loser (returns false).
   */
  @DfxCron(CronExpression.EVERY_HOUR, {
    process: Process.VIRTUAL_IBAN_FRICK_ISSUANCE_RECONCILIATION,
    timeout: 1800,
  })
  async reconcileRetiredIssuanceReferences(): Promise<void> {
    // Silent no-op when the vIBAN rail is not configured (mirrors FiatOutputFrickService status check).
    if (!this.frickVibanProvider.isAvailable()) return;

    // Shared per bankId listing cache so Phase 1 and Phase 2 never list the same bank twice in one run.
    const listingCache = new Map<number, FrickVirtualIbansFetchResult>();

    try {
      await this.runPhase1StuckIntents(listingCache);
    } catch (error) {
      // Fail-closed: any unhandled Phase 1 failure must surface as an operator alert.
      this.logger.error('Frick vIBAN reconciliation Phase 1 (stuck intents) failed:', error);
      await this.trySendFailureAlert(error, 'Phase 1');
    }

    try {
      await this.runPhase2RetiredReferences(listingCache);
    } catch (error) {
      // Fail-closed: any unhandled Phase 2 failure must surface as an operator alert.
      this.logger.error('Frick vIBAN reconciliation Phase 2 (retired references) failed:', error);
      await this.trySendFailureAlert(error, 'Phase 2');
    }
  }

  /**
   * Phase 1: for each InFlight/Failed intent, alert on a positive technical-description match.
   * An all-state, fully validated, sufficiently late listing miss is the strongest evidence this
   * bank exposes but is not authoritative proof of non-creation. Product retains the automatic
   * retry; alert operators before arming it and keep Phase 2 scanning the retired reference.
   *
   * Merge-superseded intents (`error` contains {@link MERGE_SUPERSEDED_MARKER}) are permanently
   * retired and must never be reopened — exclude them before any listing/reset work.
   */
  private async runPhase1StuckIntents(listingCache: Map<number, FrickVirtualIbansFetchResult>): Promise<void> {
    const loadedIntents = await this.dataSource.getRepository(VirtualIbanIssuanceIntent).find({
      where: {
        provider: IbanBankName.FRICK,
        status: In([VirtualIbanIssuanceIntentStatus.IN_FLIGHT, VirtualIbanIssuanceIntentStatus.FAILED]),
      },
    });

    // Permanently merge-retired intents stay FAILED with MERGE_SUPERSEDED_MARKER; never reopen them.
    const intents = loadedIntents.filter(
      (intent) => intent.error == null || !intent.error.includes(MERGE_SUPERSEDED_MARKER),
    );
    const skippedMergeSupersededCount = loadedIntents.length - intents.length;

    if (intents.length === 0) {
      this.logger.info(
        skippedMergeSupersededCount > 0
          ? `Frick vIBAN reconciliation Phase 1: no eligible InFlight/Failed intents ` +
              `(${skippedMergeSupersededCount} merge-superseded skipped)`
          : 'Frick vIBAN reconciliation Phase 1: no InFlight/Failed intents',
      );
      return;
    }

    const byBankId = new Map<number, VirtualIbanIssuanceIntent[]>();
    for (const intent of intents) {
      const group = byBankId.get(intent.bankId) ?? [];
      group.push(intent);
      byBankId.set(intent.bankId, group);
    }

    const listingMatches: StuckIntentListingMatch[] = [];
    const unprovenAbsences: UnprovenAbsenceIntent[] = [];
    let resetCount = 0;
    let skippedFreshCount = 0;
    let incompleteListingBankCount = 0;
    let skippedIncompleteCount = 0;
    let failedBankCount = 0;
    const chronicIncompleteBankIds = new Set<number>();

    for (const [bankId, group] of byBankId) {
      try {
        const listingResult = await this.getListingForBank(bankId, listingCache);
        if (
          !(listingResult.listingStartedAt instanceof Date) ||
          !Number.isFinite(listingResult.listingStartedAt.getTime()) ||
          !(listingResult.listingCompletedAt instanceof Date) ||
          !Number.isFinite(listingResult.listingCompletedAt.getTime()) ||
          listingResult.listingCompletedAt.getTime() < listingResult.listingStartedAt.getTime()
        ) {
          throw new Error(`Frick vIBAN listing timestamps invalid for bankId=${bankId}`);
        }
        const descriptions = new Set(
          listingResult.virtualIbans
            .map((viban) => viban.description)
            .filter((description): description is string => typeof description === 'string'),
        );

        // Incomplete listing: still surface positive matches (they are evidence), but never reset —
        // "not listed" is not proof of absence when validation dropped entries.
        if (!listingResult.fullyValidated) {
          incompleteListingBankCount += 1;
          this.logger.error(
            `Frick vIBAN reconciliation Phase 1: listing for bankId=${bankId} not fully validated — ` +
              `check incomplete this run; will not reset intents for this bank`,
          );
          for (const intent of group) {
            if (descriptions.has(intent.requestReference)) {
              listingMatches.push({
                intentId: intent.id,
                requestReference: intent.requestReference,
                userDataId: intent.userDataId,
                currencyId: intent.currencyId,
                bankId: intent.bankId,
                status: intent.status,
                updated: intent.updated,
              });
            } else {
              skippedIncompleteCount += 1;
              // Stuck long enough to qualify for reset, but blocked forever by incomplete listing.
              if (
                Date.now() - intent.updated.getTime() >=
                VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS
              ) {
                chronicIncompleteBankIds.add(bankId);
              }
            }
          }
          continue;
        }

        for (const intent of group) {
          if (descriptions.has(intent.requestReference)) {
            listingMatches.push({
              intentId: intent.id,
              requestReference: intent.requestReference,
              userDataId: intent.userDataId,
              currencyId: intent.currencyId,
              bankId: intent.bankId,
              status: intent.status,
              updated: intent.updated,
            });
            continue;
          }

          const ageMs = Date.now() - intent.updated.getTime();
          if (ageMs < VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS) {
            skippedFreshCount += 1;
            continue;
          }

          const latestPossibleCreateProcessedAt = new Date(
            intent.updated.getTime() + VirtualIbanFrickIssuanceReconciliationService.FRICK_CREATE_MAX_PROCESSING_MS,
          );
          if (listingResult.listingStartedAt.getTime() <= latestPossibleCreateProcessedAt.getTime()) {
            unprovenAbsences.push({
              intentId: intent.id,
              userDataId: intent.userDataId,
              currencyId: intent.currencyId,
              bankId: intent.bankId,
              status: intent.status,
              updated: intent.updated,
              listingStartedAt: listingResult.listingStartedAt,
              latestPossibleCreateProcessedAt,
            });
            continue;
          }

          const retryRisk: AutomaticRetryRiskIntent = {
            intentId: intent.id,
            requestReference: intent.requestReference,
            userDataId: intent.userDataId,
            currencyId: intent.currencyId,
            bankId: intent.bankId,
            status: intent.status,
            updated: intent.updated,
            listingStartedAt: listingResult.listingStartedAt,
            latestPossibleCreateProcessedAt,
          };
          // Alert before reopening. If alert delivery fails, the surrounding per-bank catch leaves
          // the intent unchanged, so an automatic retry is never armed silently.
          await this.sendAutomaticRetryRiskAlert(retryRisk);

          const didReset = await this.virtualIbanService.resetStuckFrickIntentForReconciliationOnly(
            intent.id,
            intent.requestReference,
            { listingStartedAt: listingResult.listingStartedAt },
          );
          if (didReset) resetCount += 1;
        }
      } catch (error) {
        // Isolate per-bank failures so one misconfigured/unreachable bank cannot abort every other bank.
        failedBankCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation Phase 1: processing failed for bankId=${bankId} — bank skipped this run:`,
          error,
        );
      }
    }

    if (listingMatches.length > 0) {
      await this.sendStuckIntentMatchAlert(listingMatches);
    }

    if (unprovenAbsences.length > 0) {
      await this.sendUnprovenAbsenceAlert(unprovenAbsences);
    }

    if (incompleteListingBankCount > 0) {
      await this.sendIncompleteListingAlert(incompleteListingBankCount, 'Phase 1');
    }

    if (chronicIncompleteBankIds.size > 0) {
      await this.sendChronicIncompleteListingAlert([...chronicIncompleteBankIds]);
    }

    if (failedBankCount > 0) {
      await this.sendPerBankFailureAlert(failedBankCount, 'Phase 1');
    }

    this.logger.info(
      `Frick vIBAN reconciliation Phase 1: checked ${intents.length} intent(s) across ${byBankId.size} bank(s); ` +
        `${listingMatches.length} listing match(es), ${resetCount} reset(s), ${skippedFreshCount} skipped (too fresh), ` +
        `${unprovenAbsences.length} skipped (listing did not prove post-create absence), ` +
        `${skippedIncompleteCount} skipped (incomplete listing across ${incompleteListingBankCount} bank(s))` +
        (skippedMergeSupersededCount > 0 ? `, ${skippedMergeSupersededCount} skipped (merge-superseded)` : ''),
    );
  }

  /**
   * Phase 2: alert when Bank Frick still lists a vIBAN under a retired (abandoned) requestReference.
   * Incomplete listings never count as "clean" for unmatched abandoned references.
   */
  private async runPhase2RetiredReferences(listingCache: Map<number, FrickVirtualIbansFetchResult>): Promise<void> {
    const { hits: abandoned, unresolved } = await this.loadAbandonedReferences();

    // Unresolved candidates (query match but no parseable abandoned reference) always alert —
    // they are the last-line-of-defense failure mode, even when zero hits are resolvable.
    if (unresolved.length > 0) {
      await this.sendUnresolvedAbandonedReferenceAlert(unresolved);
    }

    if (abandoned.length === 0) {
      if (unresolved.length === 0) {
        this.logger.info('Frick vIBAN reconciliation Phase 2: no abandoned references pending check');
      }
      return;
    }

    const byBankId = new Map<number, AbandonedReferenceHit[]>();
    for (const hit of abandoned) {
      const group = byBankId.get(hit.bankId) ?? [];
      group.push(hit);
      byBankId.set(hit.bankId, group);
    }

    const matches: AbandonedReferenceHit[] = [];
    let incompleteListingBankCount = 0;
    let incompleteUnresolvedCount = 0;
    let failedBankCount = 0;

    for (const [bankId, group] of byBankId) {
      try {
        const listingResult = await this.getListingForBank(bankId, listingCache);
        const descriptions = new Set(
          listingResult.virtualIbans
            .map((viban) => viban.description)
            .filter((description): description is string => typeof description === 'string'),
        );

        if (!listingResult.fullyValidated) {
          incompleteListingBankCount += 1;
          this.logger.error(
            `Frick vIBAN reconciliation Phase 2: listing for bankId=${bankId} not fully validated — ` +
              `check incomplete this run; unmatched abandoned references are NOT treated as clean`,
          );
          for (const hit of group) {
            if (descriptions.has(hit.abandonedReference)) {
              matches.push(hit);
            } else {
              incompleteUnresolvedCount += 1;
            }
          }
          continue;
        }

        for (const hit of group) {
          if (descriptions.has(hit.abandonedReference)) matches.push(hit);
        }
      } catch (error) {
        // Isolate per-bank failures so one misconfigured/unreachable bank cannot abort every other bank.
        failedBankCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation Phase 2: processing failed for bankId=${bankId} — bank skipped this run:`,
          error,
        );
      }
    }

    if (matches.length > 0) {
      await this.sendMatchAlert(matches);
    }

    if (incompleteListingBankCount > 0) {
      await this.sendIncompleteListingAlert(incompleteListingBankCount, 'Phase 2');
    }

    if (failedBankCount > 0) {
      await this.sendPerBankFailureAlert(failedBankCount, 'Phase 2');
    }

    if (matches.length === 0 && incompleteListingBankCount === 0) {
      this.logger.info(
        `Frick vIBAN reconciliation Phase 2: checked ${abandoned.length} abandoned reference(s), no Frick listing matches`,
      );
      return;
    }

    if (incompleteListingBankCount > 0 && matches.length === 0) {
      this.logger.info(
        `Frick vIBAN reconciliation Phase 2: checked ${abandoned.length} abandoned reference(s); ` +
          `no matches but ${incompleteUnresolvedCount} unresolved under incomplete listing(s)`,
      );
    }
  }

  /**
   * Resolve bank by id and list Frick vIBANs for its reference IBAN, caching by bankId for the run.
   */
  private async getListingForBank(
    bankId: number,
    listingCache: Map<number, FrickVirtualIbansFetchResult>,
  ): Promise<FrickVirtualIbansFetchResult> {
    const cached = listingCache.get(bankId);
    if (cached !== undefined) return cached;

    // Correctness read-through: a reference-account correction must take effect immediately and
    // must never be hidden behind BankRepository's five-minute cache.
    const bank = await this.bankService.getBankByIdUncached(bankId);
    if (!bank?.iban) {
      throw new Error(`Frick receive bank id=${bankId} (reference account IBAN) is not configured`);
    }
    if (bank.name !== IbanBankName.FRICK) {
      throw new Error(`Frick reconciliation refused non-Frick bank id=${bankId}`);
    }

    const listing = await this.frickVibanProvider.listByReferenceAccount(bank.iban);
    listingCache.set(bankId, listing);
    return listing;
  }

  /**
   * Loads every issuance-event transition that retired a requestReference.
   *
   * Identification is by marker presence in `nextError` only — not by `nextStatus`. Create-path
   * and deactivation-reopen writers use `Pending`; merge-supersede uses `Failed` with the same
   * {@link CREATE_PATH_REFERENCE_MARKER} so Phase 2 still scans permanently retired references.
   *
   * No rolling time window: a still-unresolved abandoned reference must keep being scanned and
   * (on match) alerted indefinitely. These events are rare crash-only-recovery artifacts, so
   * volume stays small; silent-forgetting after LOOKBACK_DAYS is intentionally not used.
   */
  private async loadAbandonedReferences(): Promise<{
    hits: AbandonedReferenceHit[];
    unresolved: UnresolvedAbandonedReferenceCandidate[];
  }> {
    const events = await this.dataSource.getRepository(VirtualIbanIssuanceEvent).find({
      where: [
        {
          provider: IbanBankName.FRICK,
          nextError: Like(`%${CREATE_PATH_REFERENCE_MARKER}%`),
        },
        {
          provider: IbanBankName.FRICK,
          nextError: Like(`%${RECOVERY_PATH_REFERENCE_MARKER}%`),
        },
      ],
      order: { created: 'DESC' },
    });

    const hits: AbandonedReferenceHit[] = [];
    const unresolved: UnresolvedAbandonedReferenceCandidate[] = [];
    for (const event of events) {
      // Invariant of the LIKE query above: NULL LIKE pattern is never true in SQL, so a matched
      // row cannot have nextError = null. Fail closed (throws into runPhase2RetiredReferences →
      // sendFailureAlert) if a future dialect/driver ever violates that.
      if (event.nextError == null) {
        throw new Error(
          `Frick vIBAN reconciliation Phase 2: event ${event.id} matched the abandoned-reference ` +
            `LIKE query but nextError is null (SQL invariant violated)`,
        );
      }
      // Type-narrowed: productive path guarantees non-null nextError after the check above.
      const nextError: string = event.nextError;
      const abandonedReference = this.extractAbandonedReference(nextError);
      if (abandonedReference == null) {
        this.logger.error(
          `Frick vIBAN reconciliation Phase 2: could not extract abandoned reference from event ${event.id}`,
        );
        unresolved.push({
          eventId: event.id,
          intentId: event.intentId,
          userDataId: event.userDataId,
          currencyId: event.currencyId,
          bankId: event.bankId,
          created: event.created,
          reason: 'reference_unextractable',
        });
        continue;
      }
      hits.push({
        abandonedReference,
        eventId: event.id,
        intentId: event.intentId,
        userDataId: event.userDataId,
        currencyId: event.currencyId,
        bankId: event.bankId,
        created: event.created,
      });
    }
    return { hits, unresolved };
  }

  /**
   * Extracts the retired requestReference from the exact nextError shapes written by
   * VirtualIbanService (create-path previousRequestReference=… / recovery-path under requestReference=…).
   */
  extractAbandonedReference(nextError: string): string | undefined {
    const createIdx = nextError.indexOf(CREATE_PATH_REFERENCE_MARKER);
    if (createIdx >= 0) {
      const value = this.valueAfterMarker(nextError, createIdx + CREATE_PATH_REFERENCE_MARKER.length);
      if (value.length > 0) return value;
    }

    const recoveryIdx = nextError.indexOf(RECOVERY_PATH_REFERENCE_MARKER);
    if (recoveryIdx >= 0) {
      const value = this.valueAfterMarker(nextError, recoveryIdx + RECOVERY_PATH_REFERENCE_MARKER.length);
      if (value.length > 0) return value;
    }

    return undefined;
  }

  private valueAfterMarker(text: string, start: number): string {
    const rest = text.slice(start);
    const end = rest.indexOf(';');
    return (end >= 0 ? rest.slice(0, end) : rest).trim();
  }

  private async sendStuckIntentMatchAlert(matches: StuckIntentListingMatch[]): Promise<void> {
    const errors = matches.map(
      (m) =>
        `requestReference=${m.requestReference}; intentId=${m.intentId}; ` +
        `userDataId=${m.userDataId}; currencyId=${m.currencyId}; bankId=${m.bankId}; ` +
        `status=${m.status}; updated=${m.updated.toISOString()}`,
    );

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Frick vIBAN reconciliation Phase 1: stuck intent(s) already exist at Bank Frick',
        errors,
      },
    });

    this.logger.error(
      `Frick vIBAN reconciliation Phase 1: ${matches.length} listing match(es) on stuck intent(s) — operator follow-up required`,
    );
  }

  private async sendUnprovenAbsenceAlert(intents: UnprovenAbsenceIntent[]): Promise<void> {
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Frick vIBAN reconciliation Phase 1: listing does not prove create absence',
        errors: intents.map(
          (intent) =>
            `intentId=${intent.intentId}; userDataId=${intent.userDataId}; currencyId=${intent.currencyId}; ` +
            `bankId=${intent.bankId}; status=${intent.status}; updated=${intent.updated.toISOString()}; ` +
            `listingStartedAt=${intent.listingStartedAt.toISOString()}; ` +
            `latestPossibleCreateProcessedAt=${intent.latestPossibleCreateProcessedAt.toISOString()}`,
        ),
      },
    });
    this.logger.error(
      `Frick vIBAN reconciliation Phase 1: ${intents.length} intent(s) left non-retryable because ` +
        `listing timing did not prove absence after the last possible create-processing moment`,
    );
  }

  private async sendAutomaticRetryRiskAlert(intent: AutomaticRetryRiskIntent): Promise<void> {
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Frick vIBAN reconciliation Phase 1: non-authoritative listing miss will arm automatic retry',
        errors: [
          `intentId=${intent.intentId}; userDataId=${intent.userDataId}; currencyId=${intent.currencyId}; ` +
            `bankId=${intent.bankId}; requestReference=${intent.requestReference}; status=${intent.status}; ` +
            `updated=${intent.updated.toISOString()}; listingStartedAt=${intent.listingStartedAt.toISOString()}; ` +
            `latestPossibleCreateProcessedAt=${intent.latestPossibleCreateProcessedAt.toISOString()}; ` +
            'operatorAction=check the Bank Frick portal/API across every lifecycle state for this exact ' +
            'requestReference and reference account; listing absence is not authoritative; ' +
            'worstCase=a second non-revocable external account may be created on customer retry',
        ],
      },
    });
    this.logger.error(
      `Frick vIBAN reconciliation Phase 1: intent ${intent.intentId} will be reopened on a ` +
        'non-authoritative listing miss — operator verification required',
    );
  }

  private async sendMatchAlert(matches: AbandonedReferenceHit[]): Promise<void> {
    const errors = matches.map(
      (m) =>
        `abandonedReference=${m.abandonedReference}; eventId=${m.eventId}; intentId=${m.intentId}; ` +
        `userDataId=${m.userDataId}; currencyId=${m.currencyId}; bankId=${m.bankId}; ` +
        `created=${m.created.toISOString()}`,
    );

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Frick vIBAN retired-reference reconciliation: orphan external vIBAN(s) detected',
        errors,
      },
    });

    this.logger.error(
      `Frick vIBAN reconciliation Phase 2: ${matches.length} orphan match(es) — operator follow-up required`,
    );
  }

  private async sendUnresolvedAbandonedReferenceAlert(
    candidates: UnresolvedAbandonedReferenceCandidate[],
  ): Promise<void> {
    const errors = candidates.map(
      (c) =>
        `eventId=${c.eventId}; intentId=${c.intentId}; userDataId=${c.userDataId}; ` +
        `currencyId=${c.currencyId}; bankId=${c.bankId}; created=${c.created.toISOString()}; ` +
        `reason=${c.reason}`,
    );

    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Frick vIBAN reconciliation Phase 2: abandoned-reference candidate(s) could not be resolved',
        errors,
      },
    });

    this.logger.error(
      `Frick vIBAN reconciliation Phase 2: ${candidates.length} unresolved abandoned-reference candidate(s) — operator follow-up required`,
    );
  }

  private async sendIncompleteListingAlert(bankCount: number, phase: 'Phase 1' | 'Phase 2'): Promise<void> {
    // Fixed text only — never bank IBANs or entry content. Distinct from a clean check.
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: `Frick vIBAN reconciliation ${phase}: listing not fully validated`,
        errors: [
          `Listing validation dropped one or more entries for ${bankCount} bank(s); ` +
            'this run is incomplete for those banks (no empty-listing reset / no clean Phase-2 conclusion). ' +
            'See server logs for the drop count; absence of a match alert is NOT evidence of a clean state.',
        ],
      },
    });
  }

  private async sendPerBankFailureAlert(bankCount: number, phase: 'Phase 1' | 'Phase 2'): Promise<void> {
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: `Frick vIBAN reconciliation ${phase}: processing failed for one or more banks`,
        errors: [
          `Processing threw for ${bankCount} bank(s) this run; those bank(s) were skipped and the ` +
            'rest of the run continued for every other bank. See server logs for the classified ' +
            'failure reason per bank; absence of a match alert for a skipped bank is NOT evidence of a clean state.',
        ],
      },
    });
  }

  private async sendChronicIncompleteListingAlert(bankIds: number[]): Promise<void> {
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject:
          'Frick vIBAN reconciliation Phase 1: listing chronically incomplete — stuck intent(s) cannot be resolved',
        errors: [
          `bankId(s) ${bankIds.join(', ')}: listing validation has dropped entries for long enough that ` +
            'at least one InFlight/Failed intent has passed the safety threshold with no clean check possible. ' +
            'This will keep repeating every run until the underlying listing-validation failure is fixed ' +
            '(see server logs for the drop reason) — treat as an operator incident, not a transient blip.',
        ],
      },
    });
  }

  private async sendFailureAlert(_error: unknown): Promise<void> {
    // Fixed text only — never interpolate error.message (may carry path/query PII if a provider
    // layer regresses). The calling catch already logs the Error object for operators.
    await this.notificationService.sendMail({
      type: MailType.ERROR_MONITORING,
      context: MailContext.MONITORING,
      input: {
        subject: 'Frick vIBAN retired-reference reconciliation: check could not run',
        errors: [
          'The reconciliation check itself failed; absence of a match alert is NOT evidence of a clean state. See server logs for the classified failure reason.',
        ],
      },
    });
  }

  private async trySendFailureAlert(error: unknown, phase: 'Phase 1' | 'Phase 2'): Promise<void> {
    try {
      await this.sendFailureAlert(error);
    } catch (alertError) {
      this.logger.error(`Failed to deliver Frick vIBAN reconciliation ${phase} failure alert:`, alertError);
    }
  }
}
