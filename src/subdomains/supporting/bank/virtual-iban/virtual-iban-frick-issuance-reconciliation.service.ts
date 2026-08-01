import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FrickVirtualIban, FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { FrickVirtualIbansFetchResult } from 'src/integration/bank/services/frick.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { FrickVibanProvider } from 'src/subdomains/supporting/bank/virtual-iban/providers/frick-viban.provider';
import { VirtualIbanIssuanceEvent } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntentStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent.entity';
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
  provider: IbanBankName;
  referenceAccountIban: string;
  referenceAccountReceive: boolean;
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
  virtualIbans: FrickVirtualIban[];
}

interface AbandonedReferenceMatch extends AbandonedReferenceHit {
  virtualIban: FrickVirtualIban;
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

/**
 * Periodic Frick issuance reconciliation:
 * - Phase 1: automatically adopt a uniquely identified delayed create. After a bounded recovery
 *   window, move listing misses to the safe collection-account fallback without issuing a second POST.
 * - Phase 2: automatically deactivate delayed vIBANs found under retired issuance references.
 */
@Injectable()
export class VirtualIbanFrickIssuanceReconciliationService {
  private readonly logger = new DfxLogger(VirtualIbanFrickIssuanceReconciliationService);

  /**
   * Minimum age of an InFlight/Failed Frick intent before Phase 1 escalates a listing miss to Operations.
   *
   * Derivation from BankFrickService.HTTP_TIMEOUT_MS = 30_000:
   * - authorization preflight = 30s
   * - create call worst case = 90s: original request (30s) + /authorize re-auth after 401 (30s) +
   *   one-shot retried request (30s). requestSigned has no further internal retry loop beyond that.
   * - activate call: same shape, another 90s
   * - worst-case local issuance window is therefore 210s; the 30-minute threshold is a conservative
   *   delay of more than eight times that window (the job itself runs hourly).
   */
  static readonly FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS = 1_800_000;
  static readonly FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS = 86_400_000;
  static readonly FRICK_CREATE_MAX_PROCESSING_MS = VirtualIbanService.FRICK_CREATE_MAX_PROCESSING_MS;

  constructor(
    private readonly dataSource: DataSource,
    private readonly frickVibanProvider: FrickVibanProvider,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  /**
   * `timeout: 1800` is a LockClass resumption threshold (src/shared/utils/lock.ts), not a hard abort
   * of a still-running previous tick: a run older than 1800s no longer blocks a new hour-tick from
   * starting, so two overlapping invocations are possible. Intent transitions use row/advisory locks,
   * and external cleanup targets exact vIBAN identities, making repeated work fail closed or idempotent.
   */
  @DfxCron(CronExpression.EVERY_HOUR, {
    process: Process.VIRTUAL_IBAN_FRICK_ISSUANCE_RECONCILIATION,
    timeout: 1800,
  })
  async reconcileRetiredIssuanceReferences(): Promise<void> {
    // Silent no-op when the vIBAN rail is not configured (mirrors FiatOutputFrickService status check).
    if (!this.frickVibanProvider.isAvailable()) return;

    // Shared immutable reference-account listing cache. A mutable Bank row is never re-read here:
    // each intent/event is reconciled against the account captured when the intent was created.
    const listingCache = new Map<string, FrickVirtualIbansFetchResult>();

    try {
      await this.runPhase1StuckIntents(listingCache);
    } catch (error) {
      this.logger.error('Frick vIBAN reconciliation Phase 1 (stuck intents) failed:', error);
    }

    try {
      await this.runPhase2RetiredReferences(listingCache);
    } catch (error) {
      this.logger.error('Frick vIBAN reconciliation Phase 2 (retired references) failed:', error);
    }
  }

  /**
   * Phase 1: recover delayed creates by their exact technical description. Listing misses never arm
   * a second create. After the bounded recovery window they become a terminal collection-account
   * fallback, while Phase 2 keeps watching the retired reference for a delayed external object.
   *
   * Merge-superseded intents (`error` contains {@link MERGE_SUPERSEDED_MARKER}) are permanently
   * retired and must never be reopened — exclude them before any listing work.
   */
  private async runPhase1StuckIntents(listingCache: Map<string, FrickVirtualIbansFetchResult>): Promise<void> {
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

    const byReferenceAccountSnapshot = new Map<string, VirtualIbanIssuanceIntent[]>();
    for (const intent of intents) {
      const snapshotKey = this.referenceAccountSnapshotKey(intent);
      const group = byReferenceAccountSnapshot.get(snapshotKey) ?? [];
      group.push(intent);
      byReferenceAccountSnapshot.set(snapshotKey, group);
    }

    const listingMatches: StuckIntentListingMatch[] = [];
    const unprovenAbsences: UnprovenAbsenceIntent[] = [];
    let skippedFreshCount = 0;
    let incompleteListingBankCount = 0;
    let skippedIncompleteCount = 0;
    let failedBankCount = 0;
    const chronicIncompleteBankIds = new Set<number>();

    for (const group of byReferenceAccountSnapshot.values()) {
      const snapshot = group.at(0)!;
      const bankId = snapshot.bankId;
      try {
        const listingResult = await this.getListingForReferenceAccount(
          snapshot.referenceAccountIban,
          snapshot.referenceAccountReceive,
          snapshot.provider,
          listingCache,
        );
        if (
          !(listingResult.listingStartedAt instanceof Date) ||
          !Number.isFinite(listingResult.listingStartedAt.getTime()) ||
          !(listingResult.listingCompletedAt instanceof Date) ||
          !Number.isFinite(listingResult.listingCompletedAt.getTime()) ||
          listingResult.listingCompletedAt.getTime() < listingResult.listingStartedAt.getTime()
        ) {
          throw new Error(`Frick vIBAN listing timestamps invalid for bankId=${bankId}`);
        }
        const byDescription = new Map<string, FrickVirtualIban[]>();
        for (const viban of listingResult.virtualIbans) {
          if (typeof viban.description !== 'string') continue;
          const entries = byDescription.get(viban.description) ?? [];
          entries.push(viban);
          byDescription.set(viban.description, entries);
        }

        // Incomplete listing: positive matches remain safe evidence, but absence is inconclusive.
        // "not listed" is not proof of absence when validation dropped entries.
        if (!listingResult.fullyValidated) {
          incompleteListingBankCount += 1;
          this.logger.error(
            `Frick vIBAN reconciliation Phase 1: listing for bankId=${bankId} not fully validated — ` +
              `check incomplete this run; intents for this bank remain non-retryable`,
          );
          for (const intent of group) {
            const virtualIbans = (byDescription.get(intent.requestReference) ?? []).filter((viban) =>
              [FrickVirtualIbanState.PREPARED, FrickVirtualIbanState.ACTIVE].includes(viban.state),
            );
            if (virtualIbans.length > 0) {
              listingMatches.push({
                intentId: intent.id,
                requestReference: intent.requestReference,
                userDataId: intent.userDataId,
                currencyId: intent.currencyId,
                bankId: intent.bankId,
                status: intent.status,
                updated: intent.updated,
                virtualIbans,
              });
            } else {
              skippedIncompleteCount += 1;
              // Old enough for ERROR logging, but blocked from automatic recovery by incomplete evidence.
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
          const virtualIbans = (byDescription.get(intent.requestReference) ?? []).filter((viban) =>
            [FrickVirtualIbanState.PREPARED, FrickVirtualIbanState.ACTIVE].includes(viban.state),
          );
          if (virtualIbans.length > 0) {
            listingMatches.push({
              intentId: intent.id,
              requestReference: intent.requestReference,
              userDataId: intent.userDataId,
              currencyId: intent.currencyId,
              bankId: intent.bankId,
              status: intent.status,
              updated: intent.updated,
              virtualIbans,
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

    let recoveredCount = 0;
    let recoveryFailureCount = 0;
    let duplicateCleanupCount = 0;
    const matchedIntentIds = new Set(listingMatches.map((match) => match.intentId));
    for (const match of listingMatches) {
      const candidates = [...match.virtualIbans].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.vban.localeCompare(b.vban),
      );
      const winner = candidates[0];
      try {
        for (const duplicate of candidates.slice(1)) {
          await this.frickVibanProvider.deactivateAndApprove(
            duplicate,
            duplicate.referenceAccountIban,
            match.requestReference,
          );
          duplicateCleanupCount += 1;
        }
        if (await this.virtualIbanService.recoverFrickIntentForReconciliation(match.intentId, winner)) {
          recoveredCount += 1;
          this.logger.info(`Frick vIBAN reconciliation Phase 1: automatically recovered intent ${match.intentId}`);
        }
      } catch (error) {
        recoveryFailureCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation Phase 1: automatic recovery failed for intentId=${match.intentId}`,
          error,
        );
      }
    }

    if (unprovenAbsences.length > 0) {
      this.logUnprovenAbsences(unprovenAbsences);
    }

    let fallbackCount = 0;
    for (const intent of intents) {
      if (
        matchedIntentIds.has(intent.id) ||
        Date.now() - intent.updated.getTime() <
          VirtualIbanFrickIssuanceReconciliationService.FRICK_AUTOMATIC_FALLBACK_THRESHOLD_MS
      )
        continue;
      try {
        if (
          await this.virtualIbanService.moveFrickIntentToFallbackForReconciliation(intent.id, intent.requestReference)
        )
          fallbackCount += 1;
      } catch (error) {
        this.logger.error(
          `Frick vIBAN reconciliation Phase 1: automatic fallback transition failed for intentId=${intent.id}`,
          error,
        );
      }
    }

    if (chronicIncompleteBankIds.size > 0)
      this.logger.error(
        `Frick vIBAN reconciliation Phase 1: listing chronically incomplete for bankId(s) ${[
          ...chronicIncompleteBankIds,
        ].join(', ')}`,
      );

    this.logger.info(
      `Frick vIBAN reconciliation Phase 1: checked ${intents.length} intent(s) across ` +
        `${byReferenceAccountSnapshot.size} reference-account snapshot(s); ` +
        `${listingMatches.length} listing match(es), ${skippedFreshCount} skipped (too fresh), ` +
        `${recoveredCount} recovered, ${recoveryFailureCount} recovery failure(s), ` +
        `${duplicateCleanupCount} duplicate(s) deactivated, ${fallbackCount} moved to fallback, ` +
        `${unprovenAbsences.length} inconclusive absence(s), ${failedBankCount} bank failure(s), ` +
        `${skippedIncompleteCount} skipped (incomplete listing across ${incompleteListingBankCount} bank(s))` +
        (skippedMergeSupersededCount > 0 ? `, ${skippedMergeSupersededCount} skipped (merge-superseded)` : ''),
    );
  }

  /** Phase 2: deactivate vIBANs that appear under a retired requestReference. */
  private async runPhase2RetiredReferences(listingCache: Map<string, FrickVirtualIbansFetchResult>): Promise<void> {
    const { hits: abandoned, unresolved } = await this.loadAbandonedReferences();

    if (unresolved.length > 0)
      this.logger.error(
        `Frick vIBAN reconciliation Phase 2: ${unresolved.length} abandoned reference(s) could not be extracted`,
      );

    if (abandoned.length === 0) {
      if (unresolved.length === 0) {
        this.logger.info('Frick vIBAN reconciliation Phase 2: no abandoned references pending check');
      }
      return;
    }

    const byReferenceAccountSnapshot = new Map<string, AbandonedReferenceHit[]>();
    for (const hit of abandoned) {
      const snapshotKey = this.referenceAccountSnapshotKey(hit);
      const group = byReferenceAccountSnapshot.get(snapshotKey) ?? [];
      group.push(hit);
      byReferenceAccountSnapshot.set(snapshotKey, group);
    }

    const matches: AbandonedReferenceMatch[] = [];
    let incompleteListingBankCount = 0;
    let incompleteUnresolvedCount = 0;
    let failedBankCount = 0;

    for (const group of byReferenceAccountSnapshot.values()) {
      const snapshot = group.at(0)!;
      const bankId = snapshot.bankId;
      try {
        const listingResult = await this.getListingForReferenceAccount(
          snapshot.referenceAccountIban,
          snapshot.referenceAccountReceive,
          snapshot.provider,
          listingCache,
        );
        const byDescription = new Map<string, FrickVirtualIban[]>();
        for (const viban of listingResult.virtualIbans) {
          if (typeof viban.description !== 'string') continue;
          const entries = byDescription.get(viban.description) ?? [];
          entries.push(viban);
          byDescription.set(viban.description, entries);
        }

        if (!listingResult.fullyValidated) {
          incompleteListingBankCount += 1;
          this.logger.error(
            `Frick vIBAN reconciliation Phase 2: listing for bankId=${bankId} not fully validated — ` +
              `check incomplete this run; unmatched abandoned references are NOT treated as clean`,
          );
          for (const hit of group) {
            const externalMatches = byDescription.get(hit.abandonedReference) ?? [];
            if (externalMatches.length > 0) {
              matches.push(...externalMatches.map((virtualIban) => ({ ...hit, virtualIban })));
            } else {
              incompleteUnresolvedCount += 1;
            }
          }
          continue;
        }

        for (const hit of group) {
          const externalMatches = byDescription.get(hit.abandonedReference) ?? [];
          matches.push(...externalMatches.map((virtualIban) => ({ ...hit, virtualIban })));
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

    let deactivatedCount = 0;
    let cleanupFailureCount = 0;
    const processedVibans = new Set<string>();
    for (const match of matches) {
      if (processedVibans.has(match.virtualIban.vban)) continue;
      processedVibans.add(match.virtualIban.vban);
      if (match.virtualIban.state === FrickVirtualIbanState.DEACTIVATED) continue;
      try {
        await this.frickVibanProvider.deactivateAndApprove(
          match.virtualIban,
          match.referenceAccountIban,
          match.abandonedReference,
        );
        deactivatedCount += 1;
        this.logger.info(
          `Frick vIBAN reconciliation Phase 2: automatically deactivated orphan for eventId=${match.eventId}`,
        );
      } catch (error) {
        cleanupFailureCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation Phase 2: automatic orphan cleanup failed for eventId=${match.eventId}`,
          error,
        );
      }
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

    if (matches.length > 0)
      this.logger.info(
        `Frick vIBAN reconciliation Phase 2: ${matches.length} orphan match(es), ` +
          `${deactivatedCount} deactivated, ${cleanupFailureCount} cleanup failure(s), ` +
          `${failedBankCount} bank failure(s)`,
      );
  }

  private async getListingForReferenceAccount(
    referenceAccountIban: string,
    referenceAccountReceive: boolean,
    provider: IbanBankName,
    listingCache: Map<string, FrickVirtualIbansFetchResult>,
  ): Promise<FrickVirtualIbansFetchResult> {
    if (provider !== IbanBankName.FRICK) {
      throw new Error('Frick reconciliation refused a non-Frick reference-account snapshot');
    }
    if (referenceAccountReceive !== true || !referenceAccountIban) {
      throw new Error('Frick reconciliation refused an invalid reference-account snapshot');
    }

    const cached = listingCache.get(referenceAccountIban);
    if (cached !== undefined) return cached;

    const listing = await this.frickVibanProvider.listByReferenceAccount(referenceAccountIban);
    listingCache.set(referenceAccountIban, listing);
    return listing;
  }

  private referenceAccountSnapshotKey(snapshot: {
    provider: IbanBankName;
    referenceAccountIban: string;
    referenceAccountReceive: boolean;
  }): string {
    return JSON.stringify([snapshot.provider, snapshot.referenceAccountIban, snapshot.referenceAccountReceive]);
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
      // the outer Phase-2 ERROR log) if a future dialect/driver ever violates that.
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
        provider: event.provider,
        referenceAccountIban: event.referenceAccountIban,
        referenceAccountReceive: event.referenceAccountReceive,
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

  private logUnprovenAbsences(intents: UnprovenAbsenceIntent[]): void {
    this.logger.error(
      `Frick vIBAN reconciliation Phase 1: ${intents.length} intent(s) remain inconclusive because ` +
        `listing absence is not authoritative; automatic recovery will continue`,
    );
  }
}
