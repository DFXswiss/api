import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FrickVirtualIban, FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { FrickVirtualIbansFetchResult } from 'src/integration/bank/services/frick.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { FrickVibanProvider } from 'src/subdomains/supporting/bank/virtual-iban/providers/frick-viban.provider';
import { VirtualIbanIssuanceEvent } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntentStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban-issuance-intent.entity';
import { DataSource, In, Like } from 'typeorm';
import {
  CREATE_PATH_REFERENCE_MARKER,
  FrickReconciliationRecoveryResult,
  MERGE_SUPERSEDED_MARKER,
  RECOVERY_PATH_REFERENCE_MARKER,
  VirtualIbanService,
} from './virtual-iban.service';

interface AbandonedReferenceHit {
  abandonedReference: string;
  eventId: number;
  intentId: number;
  bankId: number;
  provider: IbanBankName;
  referenceAccountIban: string;
  referenceAccountReceive: boolean;
}

interface StuckIntentListingMatch {
  intentId: number;
  /** Intent-captured reference-account IBAN snapshot — never the listing response value. */
  referenceAccountIban: string;
  bankId: number;
  virtualIbans: FrickVirtualIban[];
}

interface AbandonedReferenceMatch extends AbandonedReferenceHit {
  virtualIban: FrickVirtualIban;
}

/**
 * Periodic Frick issuance reconciliation:
 * - Phase 1: automatically adopt a uniquely identified delayed create (canonical winner only).
 *   After a bounded recovery window, move listing misses to the safe collection-account fallback
 *   without issuing a second POST. Phase 1 never deactivates duplicates.
 * - Completed-intent cleanup: sole permanently retryable duplicate deactivation for COMPLETED Frick
 *   intents (same technical description; canonical = persisted externalIban). No free-text log as state.
 * - Phase 2: automatically deactivate delayed vIBANs found under retired issuance references, with a
 *   local active/canonical protection check before every external action.
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

  private static readonly CLEANUP_TARGET_STATES: ReadonlySet<FrickVirtualIbanState> = new Set([
    FrickVirtualIbanState.PREPARED,
    FrickVirtualIbanState.ACTIVE,
    FrickVirtualIbanState.DEACTIVATION_REQUESTED,
  ]);

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
    scope: CronScope.WORKER,
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
      await this.runCompletedIntentDuplicateCleanup(listingCache);
    } catch (error) {
      this.logger.error('Frick vIBAN reconciliation completed-intent cleanup failed:', error);
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
    let unprovenAbsenceCount = 0;
    /**
     * Fallback is only armed for intents whose listing in this run succeeded with valid timestamps
     * and fullyValidated === true. Listing failures, invalid timestamps, and incomplete listings
     * exclude fallback even when the intent is older than 24h.
     */
    const fallbackEligibleIntentIds = new Set<number>();
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
        // "not listed" is not proof of absence when validation dropped entries. Fallback is excluded.
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
                referenceAccountIban: intent.referenceAccountIban,
                bankId: intent.bankId,
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
          // Successful fully-validated listing with valid timestamps — eligible for terminal fallback
          // on a miss older than 24h (positive matches still skip fallback via matchedIntentIds).
          fallbackEligibleIntentIds.add(intent.id);

          const virtualIbans = (byDescription.get(intent.requestReference) ?? []).filter((viban) =>
            [FrickVirtualIbanState.PREPARED, FrickVirtualIbanState.ACTIVE].includes(viban.state),
          );
          if (virtualIbans.length > 0) {
            listingMatches.push({
              intentId: intent.id,
              referenceAccountIban: intent.referenceAccountIban,
              bankId: intent.bankId,
              virtualIbans,
            });
            continue;
          }

          const ageMs = Date.now() - intent.updated.getTime();
          if (ageMs < VirtualIbanFrickIssuanceReconciliationService.FRICK_STUCK_INTENT_SAFETY_THRESHOLD_MS) {
            skippedFreshCount += 1;
            continue;
          }

          unprovenAbsenceCount += 1;
        }
      } catch (error) {
        // Isolate per-bank failures so one misconfigured/unreachable bank cannot abort every other bank.
        // Listing failures / invalid timestamps do not arm fallback for any intent in this group.
        failedBankCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation Phase 1: processing failed for bankId=${bankId} — bank skipped this run:`,
          error,
        );
      }
    }

    let recoveredCount = 0;
    let recoveryFailureCount = 0;
    const matchedIntentIds = new Set(listingMatches.map((match) => match.intentId));
    for (const match of listingMatches) {
      await this.recoverPhase1ListingMatch(match, {
        onRecovered: () => {
          recoveredCount += 1;
        },
        onRecoveryFailure: () => {
          recoveryFailureCount += 1;
        },
      });
    }

    if (unprovenAbsenceCount > 0) {
      this.logUnprovenAbsences(unprovenAbsenceCount);
    }

    let fallbackCount = 0;
    for (const intent of intents) {
      if (
        !fallbackEligibleIntentIds.has(intent.id) ||
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
        `${fallbackCount} moved to fallback, ${unprovenAbsenceCount} inconclusive absence(s), ` +
        `${failedBankCount} bank failure(s), ` +
        `${skippedIncompleteCount} skipped (incomplete listing across ${incompleteListingBankCount} bank(s))` +
        (skippedMergeSupersededCount > 0 ? `, ${skippedMergeSupersededCount} skipped (merge-superseded)` : ''),
    );
  }

  /**
   * Permanently retryable cleanup for COMPLETED Frick intents: list the exact technical description,
   * treat persisted `externalIban` as the sole canonical, and deactivate only other
   * PREPARED/ACTIVE/DEACTIVATION_REQUESTED entries. Failures leave the COMPLETED intent untouched so
   * the next hourly run retries — no free-text log is used as durable state.
   *
   * Fail-closed: incomplete/failed/invalid listing, cross-account mismatch, missing externalIban,
   * or canonical absent from a fully validated list → ERROR and no deactivation.
   */
  private async runCompletedIntentDuplicateCleanup(
    listingCache: Map<string, FrickVirtualIbansFetchResult>,
  ): Promise<void> {
    const intents = await this.dataSource.getRepository(VirtualIbanIssuanceIntent).find({
      where: {
        provider: IbanBankName.FRICK,
        status: VirtualIbanIssuanceIntentStatus.COMPLETED,
      },
    });

    if (intents.length === 0) {
      this.logger.info('Frick vIBAN reconciliation completed-intent cleanup: no COMPLETED Frick intents');
      return;
    }

    const byReferenceAccountSnapshot = new Map<string, VirtualIbanIssuanceIntent[]>();
    for (const intent of intents) {
      const snapshotKey = this.referenceAccountSnapshotKey(intent);
      const group = byReferenceAccountSnapshot.get(snapshotKey) ?? [];
      group.push(intent);
      byReferenceAccountSnapshot.set(snapshotKey, group);
    }

    let duplicateCleanupCount = 0;
    let cleanupFailureCount = 0;
    let protectedSkipCount = 0;
    let failedBankCount = 0;
    let incompleteListingBankCount = 0;
    // Each distinct duplicate IBAN is acted on at most once per cleanup run.
    const processedDuplicateVibans = new Set<string>();

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

        if (!listingResult.fullyValidated) {
          incompleteListingBankCount += 1;
          this.logger.error(
            `Frick vIBAN reconciliation completed-intent cleanup: listing for bankId=${bankId} not fully ` +
              `validated — no deactivation this run`,
          );
          continue;
        }

        const byDescription = new Map<string, FrickVirtualIban[]>();
        for (const viban of listingResult.virtualIbans) {
          if (typeof viban.description !== 'string') continue;
          const entries = byDescription.get(viban.description) ?? [];
          entries.push(viban);
          byDescription.set(viban.description, entries);
        }

        for (const intent of group) {
          const result = await this.cleanupCompletedIntentDuplicates(intent, byDescription, processedDuplicateVibans);
          duplicateCleanupCount += result.deactivated;
          cleanupFailureCount += result.failures;
          protectedSkipCount += result.protectedSkips;
        }
      } catch (error) {
        failedBankCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation completed-intent cleanup: processing failed for bankId=${bankId} — ` +
            `bank skipped this run:`,
          error,
        );
      }
    }

    this.logger.info(
      `Frick vIBAN reconciliation completed-intent cleanup: checked ${intents.length} COMPLETED intent(s) ` +
        `across ${byReferenceAccountSnapshot.size} reference-account snapshot(s); ` +
        `${duplicateCleanupCount} duplicate(s) deactivated, ${cleanupFailureCount} cleanup failure(s), ` +
        `${protectedSkipCount} protected skip(s), ${failedBankCount} bank failure(s), ` +
        `${incompleteListingBankCount} incomplete listing bank(s)`,
    );
  }

  /**
   * Fail-closed duplicate cleanup for one COMPLETED intent against a fully validated listing group.
   * Never deactivates the persisted canonical; never issues a second create.
   * Each distinct duplicate IBAN is acted on at most once per run via {@link processedDuplicateVibans}.
   */
  private async cleanupCompletedIntentDuplicates(
    intent: VirtualIbanIssuanceIntent,
    byDescription: Map<string, FrickVirtualIban[]>,
    processedDuplicateVibans: Set<string>,
  ): Promise<{ deactivated: number; failures: number; protectedSkips: number }> {
    const empty = { deactivated: 0, failures: 0, protectedSkips: 0 };

    if (intent.externalIban == null) {
      this.logger.error(
        `Frick vIBAN reconciliation completed-intent cleanup: missing externalIban for ` +
          `intentId=${intent.id} bankId=${intent.bankId} — no deactivation`,
      );
      return empty;
    }

    const listed = byDescription.get(intent.requestReference) ?? [];
    const expectedReferenceAccountIban = this.normalizeReferenceAccountIban(intent.referenceAccountIban);
    const crossAccountCandidates = listed.filter(
      (viban) => this.normalizeReferenceAccountIban(viban.referenceAccountIban) !== expectedReferenceAccountIban,
    );
    if (crossAccountCandidates.length > 0) {
      this.logger.error(
        `Frick vIBAN reconciliation completed-intent cleanup: cross-account listing mismatch for ` +
          `intentId=${intent.id} bankId=${intent.bankId} candidateCount=${listed.length} — no deactivation`,
      );
      return empty;
    }

    const canonicalIban = intent.externalIban;
    if (!listed.some((viban) => viban.vban === canonicalIban)) {
      this.logger.error(
        `Frick vIBAN reconciliation completed-intent cleanup: canonical IBAN not present in fully ` +
          `validated listing for intentId=${intent.id} bankId=${intent.bankId} — no deactivation`,
      );
      return empty;
    }

    const duplicates = listed.filter(
      (viban) =>
        viban.vban !== canonicalIban &&
        VirtualIbanFrickIssuanceReconciliationService.CLEANUP_TARGET_STATES.has(viban.state),
    );
    if (duplicates.length === 0) return empty;

    // PII-safe ERROR before any cleanup (intentId, bankId, candidateCount — never IBAN/description).
    this.logger.error(
      `Frick vIBAN reconciliation completed-intent cleanup: duplicate match for COMPLETED intent ` +
        `intentId=${intent.id} bankId=${intent.bankId} candidateCount=${duplicates.length + 1}`,
    );

    let deactivated = 0;
    let failures = 0;
    let protectedSkips = 0;
    for (const duplicate of duplicates) {
      // Each distinct duplicate IBAN is acted on at most once per cleanup run.
      if (processedDuplicateVibans.has(duplicate.vban)) continue;
      processedDuplicateVibans.add(duplicate.vban);

      if (await this.virtualIbanService.isIbanProtectedFromReconciliationDeactivation(duplicate.vban)) {
        protectedSkips += 1;
        this.logger.error(
          `Frick vIBAN reconciliation completed-intent cleanup: protected IBAN refused deactivation for ` +
            `intentId=${intent.id} bankId=${intent.bankId}`,
        );
        continue;
      }

      try {
        await this.frickVibanProvider.deactivateAndApprove(
          duplicate,
          intent.referenceAccountIban,
          intent.requestReference,
        );
        deactivated += 1;
        this.logger.info(
          `Frick vIBAN reconciliation completed-intent cleanup: deactivated duplicate for ` +
            `intentId=${intent.id} bankId=${intent.bankId}`,
        );
      } catch (error) {
        failures += 1;
        this.logger.error(
          `Frick vIBAN reconciliation completed-intent cleanup: duplicate cleanup failed for ` +
            `intentId=${intent.id} bankId=${intent.bankId}`,
          error,
        );
        // Remaining duplicates stay for the next hourly retry of this COMPLETED intent.
      }
    }

    return { deactivated, failures, protectedSkips };
  }

  /** Phase 2: deactivate vIBANs that appear under a retired requestReference. */
  private async runPhase2RetiredReferences(listingCache: Map<string, FrickVirtualIbansFetchResult>): Promise<void> {
    const { hits: abandoned, unresolvedCount } = await this.loadAbandonedReferences();

    if (unresolvedCount > 0)
      this.logger.error(
        `Frick vIBAN reconciliation Phase 2: ${unresolvedCount} abandoned reference(s) could not be extracted`,
      );

    if (abandoned.length === 0) {
      if (unresolvedCount === 0) {
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
    let protectedSkipCount = 0;
    const processedVibans = new Set<string>();
    for (const match of matches) {
      if (processedVibans.has(match.virtualIban.vban)) continue;
      processedVibans.add(match.virtualIban.vban);

      // Every distinct action-relevant retired-reference match: PII-safe ERROR before skip/cleanup.
      // A historical retirement marker alone never authorizes deactivation of a protected IBAN.
      this.logger.error(
        `Frick vIBAN reconciliation Phase 2: retired-reference match ` +
          `eventId=${match.eventId} intentId=${match.intentId} bankId=${match.bankId} ` +
          `state=${match.virtualIban.state}`,
      );

      if (match.virtualIban.state === FrickVirtualIbanState.DEACTIVATED) continue;

      if (await this.virtualIbanService.isIbanProtectedFromReconciliationDeactivation(match.virtualIban.vban)) {
        protectedSkipCount += 1;
        this.logger.error(
          `Frick vIBAN reconciliation Phase 2: protected IBAN refused deactivation for ` +
            `eventId=${match.eventId} intentId=${match.intentId} bankId=${match.bankId}`,
        );
        continue;
      }

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
          `${protectedSkipCount} protected skip(s), ${failedBankCount} bank failure(s)`,
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
    unresolvedCount: number;
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
    let unresolvedCount = 0;
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
        unresolvedCount += 1;
        continue;
      }
      hits.push({
        abandonedReference,
        eventId: event.id,
        intentId: event.intentId,
        bankId: event.bankId,
        provider: event.provider,
        referenceAccountIban: event.referenceAccountIban,
        referenceAccountReceive: event.referenceAccountReceive,
      });
    }
    return { hits, unresolvedCount };
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

  private logUnprovenAbsences(count: number): void {
    this.logger.error(
      `Frick vIBAN reconciliation Phase 1: ${count} intent(s) remain inconclusive because ` +
        `listing absence is not authoritative; automatic recovery will continue`,
    );
  }

  /**
   * Phase-1 positive-match handling: validate candidates against the intent reference-account
   * snapshot, log a PII-safe ERROR, and finalize or confirm exclusively the deterministic canonical
   * winner. Never deactivates duplicates here — sole duplicate cleanup is
   * {@link runCompletedIntentDuplicateCleanup} against the persisted externalIban on COMPLETED.
   * Never deactivates a raced different canonical; never issues a second create.
   */
  private async recoverPhase1ListingMatch(
    match: StuckIntentListingMatch,
    counters: {
      onRecovered: () => void;
      onRecoveryFailure: () => void;
    },
  ): Promise<void> {
    const expectedReferenceAccountIban = this.normalizeReferenceAccountIban(match.referenceAccountIban);
    const crossAccountCandidates = match.virtualIbans.filter(
      (viban) => this.normalizeReferenceAccountIban(viban.referenceAccountIban) !== expectedReferenceAccountIban,
    );
    if (crossAccountCandidates.length > 0) {
      this.logger.error(
        `Frick vIBAN reconciliation Phase 1: cross-account listing mismatch for intentId=${match.intentId} ` +
          `bankId=${match.bankId} candidateCount=${match.virtualIbans.length} — no external action`,
      );
      return;
    }

    // Chronological by epoch ms (Frick validation guarantees a finite RFC-3339 instant). vban is
    // only the deterministic tie-breaker — never localeCompare of the original createdAt string.
    const candidates = [...match.virtualIbans].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.vban.localeCompare(b.vban),
    );
    if (candidates.length === 0) return;

    // Every positive Phase-1 match of an InFlight/Failed intent: PII-safe ERROR before recovery.
    this.logger.error(
      `Frick vIBAN reconciliation Phase 1: positive listing match for InFlight/Failed intent ` +
        `intentId=${match.intentId} bankId=${match.bankId} candidateCount=${candidates.length}`,
    );

    const winner = candidates[0];
    let recoveryResult: FrickReconciliationRecoveryResult;
    try {
      recoveryResult = await this.virtualIbanService.recoverFrickIntentForReconciliation(match.intentId, winner);
    } catch (error) {
      counters.onRecoveryFailure();
      this.logger.error(
        `Frick vIBAN reconciliation Phase 1: automatic recovery failed for intentId=${match.intentId}`,
        error,
      );
      return;
    }

    if (recoveryResult.kind === 'not_eligible') {
      // No durable canonical known to this caller — leave listing untouched (fail-closed).
      this.logger.error(
        `Frick vIBAN reconciliation Phase 1: recovery not eligible after positive match for ` +
          `intentId=${match.intentId} bankId=${match.bankId} candidateCount=${candidates.length} — ` +
          `duplicates left untouched`,
      );
      return;
    }

    if (recoveryResult.canonicalIban !== winner.vban) {
      // Race already finalized a different canonical — never act on listing duplicates here.
      this.logger.error(
        `Frick vIBAN reconciliation Phase 1: raced different canonical for intentId=${match.intentId} ` +
          `bankId=${match.bankId} candidateCount=${candidates.length} — no deactivation`,
      );
      return;
    }

    if (recoveryResult.kind === 'finalized') {
      counters.onRecovered();
      this.logger.info(`Frick vIBAN reconciliation Phase 1: automatically recovered intent ${match.intentId}`);
    }

    // Duplicates are not deactivated in Phase 1. After the intent is COMPLETED with
    // externalIban = winner, runCompletedIntentDuplicateCleanup (same hourly run and every later
    // run) is the sole, protected, permanently retryable cleanup path.
  }

  private normalizeReferenceAccountIban(iban: string): string {
    return iban.replace(/\s/g, '').toUpperCase();
  }
}
