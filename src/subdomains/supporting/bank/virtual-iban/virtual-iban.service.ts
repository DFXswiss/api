import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { Bank } from '../bank/bank.entity';
import { BankService } from '../bank/bank.service';
import { IbanBankName } from '../bank/dto/bank.dto';
import { FrickVibanProvider } from './providers/frick-viban.provider';
import { ReservedViban, VibanNotCreatedError, VibanProvider } from './providers/viban-provider.interface';
import { YapealVibanProvider } from './providers/yapeal-viban.provider';
import { VirtualIbanIssuanceEvent } from './virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntent, VirtualIbanIssuanceIntentStatus } from './virtual-iban-issuance-intent.entity';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

/**
 * Sentinel returned by {@link VirtualIbanService.findAndFinalizeFrickIssuance} when the Frick listing
 * call succeeded and proved zero matches for the intent's requestReference. Distinct from a thrown
 * error (listing itself failed / ambiguous) and from a finalized VirtualIban (match found).
 */
const FrickRecoveryNotFound = Symbol('FrickRecoveryNotFound');

/**
 * Prefixes written into issuance-event `nextError` when a Frick requestReference is retired.
 * Written by reconciliation Phase 1, deactivation reopen, and account-merge supersede (via
 * CREATE_PATH_REFERENCE_MARKER co-located in the merge-fail message). Request-path issuance never
 * retires references on its own. Phase 2 of the reconciliation job parses these markers; keep
 * writer and parser on the same constants.
 *
 * CREATE_PATH_REFERENCE_MARKER is the current writer format.
 * RECOVERY_PATH_REFERENCE_MARKER is retained for parsing any historical events from older builds.
 */
export const CREATE_PATH_REFERENCE_MARKER = 'previousRequestReference=';
export const RECOVERY_PATH_REFERENCE_MARKER = 'recovery listing found no match under requestReference=';

/**
 * Substring written into an issuance intent's/event's `error` when the intent is permanently
 * retired because an account merge consolidated its (currency, bank) pairing onto the surviving
 * master's own intent — distinct from CREATE_PATH_REFERENCE_MARKER's "temporarily abandoned, may
 * still resolve at Bank Frick" semantics. A merge-retired intent must never be reopened or
 * completed over. Written by resolveMergedVirtualIbanPairLocked and resolveIssuanceIntentsForMergeLocked
 * (via failFrickIntentLocked). finalizeFrickIssuance checks for it directly (B2) to refuse reviving a
 * merge-terminated intent; reconciliation Phase 2 finds it via the co-located
 * CREATE_PATH_REFERENCE_MARKER in the same message to keep the retired reference visible for the
 * orphan scan.
 */
export const MERGE_SUPERSEDED_MARKER = 'merge-superseded';

@Injectable()
export class VirtualIbanService {
  private readonly logger = new DfxLogger(VirtualIbanService);

  /**
   * Bounded wait for a parallel claim winner before falling back to recovery (F3).
   * Still useful after fail-closed empty-listing: when the winner finishes inside this window the
   * loser returns the completed IBAN without a spurious 503. On timeout the loser falls through to
   * recovery; empty listing now fails closed (no rotate/retry) instead of issuing a second POST.
   */
  private static readonly FRICK_CLAIM_WAIT_TOTAL_MS = 3000;
  private static readonly FRICK_CLAIM_WAIT_INTERVAL_MS = 500;

  /** Providers eligible for implicit/default personal-IBAN behavior. Frick is explicit opt-in only. */
  private readonly genericProviders: VibanProvider[];

  constructor(
    private readonly virtualIbanRepo: VirtualIbanRepository,
    private readonly bankService: BankService,
    private readonly fiatService: FiatService,
    private readonly yapealVibanProvider: YapealVibanProvider,
    private readonly frickVibanProvider: FrickVibanProvider,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {
    this.genericProviders = [this.yapealVibanProvider];
  }

  isUserEligible(currencyName: string, userData: UserData): boolean {
    return this.hasProviderForCurrency(currencyName) && userData.kycLevel >= KycLevel.LEVEL_50;
  }

  /** Bank Frick is exclusively available through the explicit selector path. */
  async getActiveForUserAndCurrency(userData: UserData, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOne({
      where: {
        userData: { id: userData.id },
        currency: { name: currencyName },
        bank: { name: Not(IbanBankName.FRICK) },
        // User-level and buy-bound personal IBANs are deliberately disjoint pools: a buy-bound vIBAN
        // is scoped to one specific Buy route and must never be silently reused as "the" user-level
        // personal IBAN, and vice versa.
        buy: IsNull(),
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
      relations: { bank: true },
      order: { id: 'ASC' },
    });
  }

  async getByIdForUser(id: number, userDataId: number): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOne({
      where: {
        id,
        userData: { id: userDataId },
      },
      relations: { bank: true, currency: true, userData: true, buy: true },
    });
  }

  async createForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    const existing = await this.getActiveForUserAndCurrency(userData, currencyName);
    if (existing) throw new ConflictException('User already has an active personal IBAN for this currency');

    return this.createVirtualIban(userData, currencyName);
  }

  async createForBuy(userData: UserData, buy: Buy, currencyName: string): Promise<VirtualIban> {
    const existingForBuy = await this.getActiveForBuyAndCurrency(buy.id, currencyName);
    if (existingForBuy) throw new ConflictException('Buy already has an active personal IBAN for this currency');

    return this.createVirtualIban(userData, currencyName, buy);
  }

  /** Fail-closed, cross-instance-safe Frick issuance for the explicit selector path. */
  async getOrCreateFrickForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    if (currencyName !== 'EUR') throw new BadRequestException(QuoteError.PERSONAL_IBAN_CURRENCY_NOT_SUPPORTED);

    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException(QuoteError.KYC_REQUIRED);

    if (!this.frickVibanProvider.isAvailable()) {
      this.logger.error('Bank Frick virtual IBAN service is not available');
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException(QuoteError.CURRENCY_UNSUPPORTED);

    const bank = await this.bankService.getBankInternal(IbanBankName.FRICK, currencyName);
    if (!bank?.receive) throw new BadRequestException(QuoteError.NO_BANK_AVAILABLE_FOR_THIS_CURRENCY);

    const initial = await this.initializeFrickIntent(userData, bank, currency);
    if (initial.existing) return initial.existing;

    if (initial.intent.status !== VirtualIbanIssuanceIntentStatus.PENDING)
      return this.resolveExistingFrickIntent(initial.intent, userData, bank, currency);

    return this.issueFrickFromPendingIntent(initial.intent, userData, bank, currency);
  }

  /**
   * Regular Frick issuance path for a PENDING intent: prepare → claim → reserve (with recovery).
   * Only entered for currently-Pending intents (first claim or after a same-reference VibanNotCreatedError
   * reset). Never re-entered after an empty recovery listing — that path is fail-closed until the
   * reconciliation job reopens the intent.
   */
  private async issueFrickFromPendingIntent(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban> {
    // Authentication, validation, and signing are completed before the durable claim. A failure here
    // leaves the intent Pending and therefore safely retryable without any possibility of a sent POST.
    try {
      await this.frickVibanProvider.prepareVibanReservation(bank.iban, intent.requestReference);
    } catch (error) {
      this.logger.error(
        `Bank Frick personal IBAN preflight failed (intentId=${intent.id}, userDataId=${userData.id}, ` +
          `currencyId=${currency.id}, bankId=${bank.id})`,
        error instanceof Error ? error : undefined,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    const claim = await this.claimPendingFrickIntent(intent.id);
    if (!claim.claimed) {
      // Losing parallel claimant: wait briefly for the winner before recovery (F3).
      const afterWait = await this.waitForFrickClaimWinner(claim.intent.id);
      return this.resolveExistingFrickIntent(afterWait, userData, bank, currency);
    }

    // No database connection is held across Bank Frick I/O. While an intent remains InFlight/Failed,
    // retries can only reconcile the exact technical description and never issue another POST.
    // An empty recovery listing is NOT proof of non-existence (another process may still be mid-flight);
    // that case fails closed and leaves the intent for the hourly reconciliation job.
    return this.reserveAndFinalizeFrickIssuance(claim.intent, userData, bank, currency);
  }

  private async reserveAndFinalizeFrickIssuance(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban> {
    try {
      const reserved = await this.frickVibanProvider.reserveViban(bank.iban, intent.requestReference);
      return await this.finalizeFrickIssuance(intent.id, intent.requestReference, userData, bank, currency, reserved);
    } catch (error) {
      if (error instanceof VibanNotCreatedError) {
        // Provider-layer classification only — never raw upstream text (path/query can carry IBANs).
        await this.resetFrickIntentToPending(
          intent.id,
          intent.requestReference,
          'Bank Frick virtual IBAN create rejected',
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }

      let recoveryError: unknown;
      try {
        const recovered = await this.findAndFinalizeFrickIssuance(intent, userData, bank, currency);
        if (recovered !== FrickRecoveryNotFound) return recovered;
      } catch (caught) {
        recoveryError = caught;
      }

      // Listing succeeded and proved zero matches. That is NOT safe proof of non-existence while a
      // concurrent create may still be mid-flight at Bank Frick (HTTP timeouts up to 30s per call,
      // create+activate, possible 401 retry). Leave the intent exactly as reserveViban left it
      // (InFlight) — no reset, no reference rotation, no second POST. Reconciliation is the only
      // reopener after a safety age threshold.
      if (recoveryError === undefined) {
        this.logger.error(
          `Bank Frick personal IBAN issuance failed with empty recovery listing; leaving intent ` +
            `${intent.id} unchanged for reconciliation (userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id})`,
          error instanceof Error ? error : undefined,
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }

      // Recovery listing itself failed (or adopt/finalize threw) → ambiguous, fail closed permanently.
      // Persist only a fixed classification — never raw provider/create messages (F7/G8 leak).
      const detail = 'Bank Frick virtual IBAN create failed; recovery failed';
      await this.failFrickIntent(intent.id, detail);
      this.logger.error(
        `Bank Frick personal IBAN issuance failed (intentId=${intent.id}, userDataId=${userData.id}, ` +
          `currencyId=${currency.id}, bankId=${bank.id}): create and recovery both failed`,
        recoveryError instanceof Error ? recoveryError : error instanceof Error ? error : undefined,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }
  }

  private newFrickRequestReference(): string {
    return `dfx-viban-${Util.randomString(32).toLowerCase()}`;
  }

  /**
   * Polls the intent row outside any transaction for a bounded window so a losing parallel claimant
   * can observe the winner's COMPLETED status before falling back to recovery.
   *
   * On timeout the caller still runs fail-closed recovery (adopt if found; 503 without rotate/retry
   * if empty). This wait only avoids a spurious 503 when the winner finishes quickly.
   */
  private async waitForFrickClaimWinner(intentId: number): Promise<VirtualIbanIssuanceIntent> {
    const deadline = Date.now() + VirtualIbanService.FRICK_CLAIM_WAIT_TOTAL_MS;
    for (;;) {
      const intent = await this.dataSource.manager.findOne(VirtualIbanIssuanceIntent, { where: { id: intentId } });
      if (!intent) {
        this.logger.error(`Bank Frick virtual IBAN issuance intent not found (id=${intentId})`);
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }
      if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) return intent;
      if (Date.now() >= deadline) return intent;
      await Util.delay(VirtualIbanService.FRICK_CLAIM_WAIT_INTERVAL_MS);
    }
  }

  private async initializeFrickIntent(
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<{ intent: VirtualIbanIssuanceIntent; existing: VirtualIban | null }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO "virtual_iban_issuance_intent"
          ("requestReference", "userDataId", "currencyId", "bankId", "status", "externalIban", "error")
         VALUES ($1, $2, $3, $4, $5, NULL, NULL)
         ON CONFLICT ("userDataId", "currencyId", "bankId") DO NOTHING`,
        [this.newFrickRequestReference(), userData.id, currency.id, bank.id, VirtualIbanIssuanceIntentStatus.PENDING],
      );

      let intent = await this.getFrickIntentForUpdate(manager, userData.id, currency.id, bank.id);
      const existing = await this.findActiveForUserCurrencyAndBank(manager, userData.id, currency.id, bank.id);
      if (existing) {
        if (intent.externalIban && intent.externalIban !== existing.iban) {
          this.logger.error(
            `Bank Frick issuance intent conflicts with the active personal IBAN ` +
              `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id}, ` +
              `virtualIbanId=${existing.id}, ibanMismatch=true)`,
          );
          throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
        }
        intent = await this.transitionFrickIntent(
          manager,
          intent,
          VirtualIbanIssuanceIntentStatus.COMPLETED,
          existing.iban,
          null,
        );
      }
      return { intent, existing };
    });
  }

  private async claimPendingFrickIntent(
    intentId: number,
  ): Promise<{ intent: VirtualIbanIssuanceIntent; claimed: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      let intent = await this.getFrickIntentByIdForUpdate(manager, intentId);
      if (intent.status !== VirtualIbanIssuanceIntentStatus.PENDING) return { intent, claimed: false };

      intent = await this.transitionFrickIntent(
        manager,
        intent,
        VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
        intent.externalIban,
        null,
      );
      return { intent, claimed: true };
    });
  }

  private async resolveExistingFrickIntent(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban> {
    if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED && intent.externalIban)
      return this.finalizeFrickIssuance(intent.id, intent.requestReference, userData, bank, currency, {
        iban: intent.externalIban,
        providerAccountRef: intent.externalIban,
      });

    if (
      intent.status !== VirtualIbanIssuanceIntentStatus.IN_FLIGHT &&
      intent.status !== VirtualIbanIssuanceIntentStatus.FAILED
    ) {
      this.logger.error(
        `Bank Frick virtual IBAN issuance is in unexpected status ${intent.status} (intentId=${intent.id})`,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    let recovered: VirtualIban | typeof FrickRecoveryNotFound;
    try {
      recovered = await this.findAndFinalizeFrickIssuance(intent, userData, bank, currency);
    } catch (error) {
      this.logger.error(
        `Bank Frick virtual IBAN issuance state could not be recovered; refusing a second create ` +
          `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id})`,
        error instanceof Error ? error : undefined,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    if (recovered !== FrickRecoveryNotFound) return recovered;

    // Empty listing on the request path is fail-closed: do not reset, rotate, or re-enter issuance.
    this.logger.error(
      `Bank Frick virtual IBAN issuance recovery listing empty; refusing a second create ` +
        `(intentId=${intent.id}, status=${intent.status})`,
    );
    throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
  }

  /**
   * Attempts to recover a Frick-side vIBAN for the intent's requestReference and finalize it.
   * Returns {@link FrickRecoveryNotFound} only when the listing call succeeded and found zero matches
   * (proven empty). Listing/adopt/finalize failures propagate so callers can treat them as ambiguous.
   */
  private async findAndFinalizeFrickIssuance(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban | typeof FrickRecoveryNotFound> {
    const match = await this.frickVibanProvider.findRecoverableByDescription(intent.requestReference, bank.iban);
    if (!match) return FrickRecoveryNotFound;

    const reserved = await this.frickVibanProvider.adoptAndActivate(match);
    return this.finalizeFrickIssuance(intent.id, intent.requestReference, userData, bank, currency, reserved);
  }

  private async finalizeFrickIssuance(
    intentId: number,
    expectedRequestReference: string,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    reserved: ReservedViban,
  ): Promise<VirtualIban> {
    const virtualIban = await this.dataSource.transaction(async (manager) => {
      const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);

      if (intent.requestReference !== expectedRequestReference) {
        this.logger.error(
          `Bank Frick finalize refused: requestReference changed under lock ` +
            `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id})`,
        );
        await this.sendReferenceIntegrityAlert('finalize: requestReference changed under lock', {
          intentId: intent.id,
          userDataId: userData.id,
          currencyId: currency.id,
          bankId: bank.id,
        });
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }

      // Merge-driven fail does not rotate requestReference, so the check above cannot catch it.
      if (
        intent.status === VirtualIbanIssuanceIntentStatus.FAILED &&
        intent.error != null &&
        intent.error.includes(MERGE_SUPERSEDED_MARKER)
      ) {
        this.logger.error(
          `Bank Frick finalize refused: intent was terminated by an account merge ` +
            `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id})`,
        );
        await this.sendReferenceIntegrityAlert('finalize: intent was terminated by an account merge', {
          intentId: intent.id,
          userDataId: userData.id,
          currencyId: currency.id,
          bankId: bank.id,
        });
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }

      if (intent.externalIban && intent.externalIban !== reserved.iban) {
        this.logger.error(
          `Bank Frick issuance intent conflicts with the recovered personal IBAN ` +
            `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id}, ` +
            `ibanMismatch=true)`,
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }

      const virtualIban = await this.persistUserLevelIfMissing(manager, userData, bank, currency, reserved);
      await this.transitionFrickIntent(manager, intent, VirtualIbanIssuanceIntentStatus.COMPLETED, reserved.iban, null);
      return virtualIban;
    });
    this.virtualIbanRepo.invalidateCache();
    return virtualIban;
  }

  private async failFrickIntent(intentId: number, message: string): Promise<void> {
    await this.dataSource.transaction((manager) => this.failFrickIntentLocked(manager, intentId, message));
  }

  private async failFrickIntentLocked(manager: EntityManager, intentId: number, message: string): Promise<void> {
    const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);
    if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) return;
    await this.transitionFrickIntent(
      manager,
      intent,
      VirtualIbanIssuanceIntentStatus.FAILED,
      intent.externalIban,
      message,
    );
  }

  /**
   * Same-reference reset used only for VibanNotCreatedError (provider positively proved nothing was
   * created, e.g. pre-dispatch/4xx). Does NOT rotate requestReference and does not re-enter issuance
   * in the same call — the caller's throw ends the request; a later customer retry may claim Pending.
   */
  private async resetFrickIntentToPending(
    intentId: number,
    expectedRequestReference: string,
    message: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);

      if (intent.requestReference !== expectedRequestReference) {
        this.logger.error(
          `Bank Frick reset refused: requestReference changed under lock ` +
            `(intentId=${intent.id}, userDataId=${intent.userDataId}, currencyId=${intent.currencyId}, bankId=${intent.bankId})`,
        );
        await this.sendReferenceIntegrityAlert('reset: requestReference changed under lock', {
          intentId: intent.id,
          userDataId: intent.userDataId,
          currencyId: intent.currencyId,
          bankId: intent.bankId,
        });
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }

      // No merge-superseded check: allowedSourceStatuses is [IN_FLIGHT] only, and a merge-terminated
      // intent is always FAILED — already excluded by the status gate in resetFrickIntentToPendingLocked.
      await this.resetFrickIntentToPendingLocked(
        manager,
        intent,
        [VirtualIbanIssuanceIntentStatus.IN_FLIGHT],
        message,
        false,
        null,
      );
    });
  }

  private async sendReferenceIntegrityAlert(
    reason: string,
    details: { intentId: number; userDataId: number; currencyId: number; bankId: number },
  ): Promise<void> {
    await this.notificationService
      .sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.MONITORING,
        input: {
          subject: 'Frick vIBAN issuance: requestReference integrity check failed under lock',
          errors: [
            `reason=${reason}; intentId=${details.intentId}; userDataId=${details.userDataId}; ` +
              `currencyId=${details.currencyId}; bankId=${details.bankId}`,
          ],
        },
      })
      .catch((error) => {
        // Never let a notification-delivery failure mask the real ServiceUnavailableException the
        // caller is about to throw — log and continue, do not rethrow.
        this.logger.error('Failed to send Frick vIBAN requestReference integrity alert', error);
      });
  }

  /**
   * Sole legitimate reopener of stuck Frick issuance intents after an empty Bank Frick listing.
   *
   * ONLY {@link VirtualIbanFrickIssuanceReconciliationService} Phase 1 may call this — never the
   * request path. Rotates `requestReference` under a pessimistic row lock after re-checking that
   * status is still InFlight/Failed and the reference is still the expected (pre-reset) value.
   *
   * @returns true when this call performed the reset; false when a concurrent transition already moved
   *          the row (second job run, VibanNotCreatedError reset, or completion).
   */
  async resetStuckFrickIntentForReconciliationOnly(
    intentId: number,
    expectedRequestReference: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);
      if (intent.requestReference !== expectedRequestReference) return false;

      // Merge-driven fail does not rotate requestReference. A concurrent account merge can mark this
      // intent FAILED with MERGE_SUPERSEDED_MARKER between the caller's unguarded pre-filter and this
      // locked recheck. Return false (no reset) — runPhase1StuckIntents already treats that marker as
      // "skip silently"; no new alert is warranted on this race.
      if (
        intent.status === VirtualIbanIssuanceIntentStatus.FAILED &&
        intent.error != null &&
        intent.error.includes(MERGE_SUPERSEDED_MARKER)
      ) {
        return false;
      }

      const newRequestReference = this.newFrickRequestReference();
      const message = (
        `reconciliation: empty listing after safety threshold; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${intent.requestReference}; newRequestReference=${newRequestReference}`
      ).slice(0, 2000);

      return this.resetFrickIntentToPendingLocked(
        manager,
        intent,
        [VirtualIbanIssuanceIntentStatus.IN_FLIGHT, VirtualIbanIssuanceIntentStatus.FAILED],
        message,
        true,
        newRequestReference,
      );
    });
  }

  /**
   * Shared reset-to-Pending for Frick issuance intents (request path, reconciliation, deactivation).
   *
   * - Only transitions when the current status is in `allowedSourceStatuses` (callers pass the set
   *   appropriate to their path: InFlight; InFlight|Failed; Completed; …).
   * - Always clears `externalIban` — never carry a dead IBAN forward on reopen.
   * - When `rotateReference` is true, `nextRequestReference` must be a fresh non-null reference
   *   (Bank Frick already has a real object under a retired Completed/abandoned reference;
   *   reusing it is unsafe). When false, pass `null` and the existing reference is kept.
   * - Always event-logs via {@link transitionFrickIntent}; never a silent state change.
   *
   * @returns true when this call performed the reset; false when status was not an allowed source.
   */
  private async resetFrickIntentToPendingLocked(
    manager: EntityManager,
    intent: VirtualIbanIssuanceIntent,
    allowedSourceStatuses: ReadonlyArray<VirtualIbanIssuanceIntentStatus>,
    message: string,
    rotateReference: boolean,
    nextRequestReference: string | null,
  ): Promise<boolean> {
    if (!allowedSourceStatuses.includes(intent.status)) return false;

    if (rotateReference) {
      if (nextRequestReference == null) {
        this.logger.error(
          `resetFrickIntentToPendingLocked requires nextRequestReference when rotating ` +
            `(intentId=${intent.id}, status=${intent.status})`,
        );
        throw new Error(
          `resetFrickIntentToPendingLocked requires nextRequestReference when rotating (intentId=${intent.id})`,
        );
      }
      await this.transitionFrickIntent(
        manager,
        intent,
        VirtualIbanIssuanceIntentStatus.PENDING,
        null,
        message,
        nextRequestReference,
      );
      return true;
    }

    if (nextRequestReference != null) {
      this.logger.error(
        `resetFrickIntentToPendingLocked must not receive nextRequestReference when not rotating ` +
          `(intentId=${intent.id}, status=${intent.status})`,
      );
      throw new Error(
        `resetFrickIntentToPendingLocked must not receive nextRequestReference when not rotating (intentId=${intent.id})`,
      );
    }

    await this.transitionFrickIntent(manager, intent, VirtualIbanIssuanceIntentStatus.PENDING, null, message);
    return true;
  }

  private async transitionFrickIntent(
    manager: EntityManager,
    intent: VirtualIbanIssuanceIntent,
    nextStatus: VirtualIbanIssuanceIntentStatus,
    nextExternalIban: string | null,
    nextError: string | null,
    nextRequestReference?: string,
  ): Promise<VirtualIbanIssuanceIntent> {
    const referenceUnchanged = nextRequestReference === undefined || intent.requestReference === nextRequestReference;
    if (
      intent.status === nextStatus &&
      intent.externalIban === nextExternalIban &&
      intent.error === nextError &&
      referenceUnchanged
    )
      return intent;

    const intentIds = {
      intentId: intent.id,
      userDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
    };
    const event = manager.create(VirtualIbanIssuanceEvent, {
      intentId: intent.id,
      userDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
      previousStatus: intent.status,
      nextStatus,
      previousVirtualIbanId: await this.resolveVirtualIbanId(manager, intent.externalIban, intentIds),
      nextVirtualIbanId: await this.resolveVirtualIbanId(manager, nextExternalIban, intentIds),
      previousError: intent.error,
      nextError,
    });
    await manager.save(event);

    intent.status = nextStatus;
    intent.externalIban = nextExternalIban;
    intent.error = nextError;
    if (nextRequestReference !== undefined) intent.requestReference = nextRequestReference;
    return manager.save(intent);
  }

  /**
   * Resolves the VirtualIban.id for a stored IBAN value, for the event log's by-reference columns
   * (never stores the IBAN itself there — see VirtualIbanIssuanceEvent). Returns null for null/undefined
   * input (no IBAN to reference) — this is the expected common case (most transitions don't touch it).
   *
   * On a genuine miss (should not happen: externalIban is only set to a value just persisted as
   * VirtualIban.iban), still returns null so the enclosing state transition is not aborted — aborting
   * a successful/necessary money-path transition for a secondary audit pointer would be
   * disproportionate. The miss is made loud instead: logger.error plus
   * {@link sendReferenceIntegrityAlert} with intent identifiers only (never the raw IBAN), so the
   * inconsistency is operationally reconstructible without silently masking it.
   */
  private async resolveVirtualIbanId(
    manager: EntityManager,
    iban: string | null | undefined,
    intentIds: { intentId: number; userDataId: number; currencyId: number; bankId: number },
  ): Promise<number | null> {
    if (iban == null) return null;
    const found = await manager.findOne(VirtualIban, { where: { iban }, select: ['id'] });
    if (found != null) return found.id;

    this.logger.error(
      `resolveVirtualIbanId: genuine miss — no VirtualIban row for stored IBAN ` +
        `(intentId=${intentIds.intentId}, userDataId=${intentIds.userDataId}, ` +
        `currencyId=${intentIds.currencyId}, bankId=${intentIds.bankId})`,
    );
    await this.sendReferenceIntegrityAlert(
      'resolveVirtualIbanId: genuine miss — no VirtualIban row for stored IBAN',
      intentIds,
    );
    return null;
  }

  private async getFrickIntentForUpdate(
    manager: EntityManager,
    userDataId: number,
    currencyId: number,
    bankId: number,
  ): Promise<VirtualIbanIssuanceIntent> {
    const intent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId, currencyId, bankId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!intent) {
      this.logger.error(
        `Bank Frick virtual IBAN issuance intent could not be created ` +
          `(userDataId=${userDataId}, currencyId=${currencyId}, bankId=${bankId})`,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }
    return intent;
  }

  private async getFrickIntentByIdForUpdate(manager: EntityManager, id: number): Promise<VirtualIbanIssuanceIntent> {
    const intent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!intent) {
      this.logger.error(`Bank Frick virtual IBAN issuance intent not found (id=${id})`);
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }
    return intent;
  }

  private async persistUserLevelIfMissing(
    manager: EntityManager,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    reserved: ReservedViban,
  ): Promise<VirtualIban> {
    const byIban = await manager.findOne(VirtualIban, {
      where: { iban: reserved.iban },
      relations: { bank: true, buy: true, currency: true, userData: true },
    });
    if (byIban) {
      if (
        byIban.userData?.id !== userData.id ||
        byIban.bank?.id !== bank.id ||
        byIban.currency?.id !== currency.id ||
        byIban.buy
      ) {
        this.logger.error(
          `Bank Frick virtual IBAN has an incompatible local binding ` +
            `(virtualIbanId=${byIban.id}, localUserDataId=${byIban.userData?.id}, ` +
            `requestedUserDataId=${userData.id}, localBankId=${byIban.bank?.id}, ` +
            `localCurrencyId=${byIban.currency?.id}, hasBuy=${Boolean(byIban.buy)})`,
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }
      if (!byIban.active || byIban.status !== VirtualIbanStatus.ACTIVE) {
        this.logger.error(
          `Bank Frick virtual IBAN is inactive and requires manual review ` +
            `(virtualIbanId=${byIban.id}, active=${byIban.active}, status=${byIban.status})`,
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }
      if (reserved.bban != null && byIban.bban !== reserved.bban) {
        this.logger.error(
          `Bank Frick virtual IBAN BBAN conflicts with the local record ` +
            `(virtualIbanId=${byIban.id}, userDataId=${userData.id}, bbanMismatch=true)`,
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }
      if (reserved.providerAccountRef != null && byIban.providerAccountRef !== reserved.providerAccountRef) {
        this.logger.error(
          `Bank Frick virtual IBAN provider reference conflicts with the local record ` +
            `(virtualIbanId=${byIban.id}, userDataId=${userData.id}, providerRefMismatch=true)`,
        );
        throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
      }
      return byIban;
    }

    const existingActive = await this.findActiveForUserCurrencyAndBank(manager, userData.id, currency.id, bank.id);
    if (existingActive) {
      this.logger.error(
        `A different active Bank Frick personal IBAN already exists ` +
          `(userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id}, ` +
          `existingVirtualIbanId=${existingActive.id}, ibanMismatch=true)`,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    return this.persistUserLevel(manager, userData, bank, currency, reserved);
  }

  private async persistUserLevel(
    manager: EntityManager,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    reserved: ReservedViban,
  ): Promise<VirtualIban> {
    const virtualIban = manager.create(VirtualIban, {
      userData,
      bank,
      currency,
      iban: reserved.iban,
      bban: reserved.bban,
      providerAccountRef: reserved.providerAccountRef,
      status: VirtualIbanStatus.ACTIVE,
      active: true,
      activatedAt: new Date(),
      buy: null,
    });

    return manager.save(virtualIban);
  }

  /**
   * User-level pool only (`buy: IsNull()`): buy-bound vibans are a deliberately disjoint pool and
   * must never satisfy a user-level lookup (and vice versa via {@link getActiveForBuyAndCurrency}).
   */
  private async findActiveForUserCurrencyAndBank(
    manager: EntityManager,
    userDataId: number,
    currencyId: number,
    bankId: number,
  ): Promise<VirtualIban | null> {
    return manager.findOne(VirtualIban, {
      where: {
        userData: { id: userDataId },
        currency: { id: currencyId },
        bank: { id: bankId },
        buy: IsNull(),
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
      relations: { bank: true, currency: true, userData: true, buy: true },
      order: { id: 'ASC' },
    });
  }

  private async createVirtualIban(userData: UserData, currencyName: string, buy?: Buy): Promise<VirtualIban> {
    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const provider = this.getProvider(currencyName);
    const bank = await this.bankService.getBankInternal(provider.bankName, currencyName);
    if (!bank?.receive) throw new BadRequestException('No bank available for this currency');

    const { iban, bban, providerAccountRef } = await provider.reserveViban(bank.iban);

    const virtualIban = this.virtualIbanRepo.create({
      userData,
      bank,
      currency,
      iban,
      bban,
      providerAccountRef,
      status: VirtualIbanStatus.ACTIVE,
      active: true,
      activatedAt: new Date(),
      buy,
      label: buy?.asset?.name,
    });

    const saved = await this.virtualIbanRepo.save(virtualIban);

    this.virtualIbanRepo.invalidateCache();

    return saved;
  }

  /**
   * Buy-bound pool only (`buy: { id }`): complementary to the user-level pool filtered with
   * `buy: IsNull()` in {@link getActiveForUserAndCurrency} / {@link findActiveForUserCurrencyAndBank}.
   * The two pools are deliberately disjoint.
   */
  async getActiveForBuyAndCurrency(buyId: number, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneCached(`buy-${buyId}-${currencyName}`, {
      where: {
        buy: { id: buyId },
        currency: { name: currencyName },
        bank: { name: Not(IbanBankName.FRICK) },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
    });
  }

  async getByIban(iban: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneCached(iban, {
      where: { iban },
      relations: { userData: true, bank: true, buy: true },
    });
  }

  async countActiveForUser(userDataId: number): Promise<number> {
    return this.virtualIbanRepo.countBy({
      userData: { id: userDataId },
      active: true,
      status: VirtualIbanStatus.ACTIVE,
    });
  }

  async getBaseAccountIban(iban: string): Promise<string | undefined> {
    return this.getByIban(iban).then((viban) => viban?.bank.iban);
  }

  async getVirtualIbanByKey(key: string, value: any): Promise<VirtualIban> {
    return this.virtualIbanRepo
      .createQueryBuilder('virtualIban')
      .select('virtualIban')
      .leftJoinAndSelect('virtualIban.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('virtualIban.currency', 'currency')
      .leftJoinAndSelect('virtualIban.bank', 'bank')
      .where(`${key.includes('.') ? key : `virtualIban.${key}`} = :param`, { param: value })
      .getOne();
  }

  async getVirtualIbansForAccount(userDataId: number): Promise<VirtualIban[]> {
    return this.virtualIbanRepo.findCachedBy(`user-${userDataId}`, { userData: { id: userDataId } });
  }

  private async deactivateVirtualIbanLocked(manager: EntityManager, virtualIban: VirtualIban): Promise<VirtualIban> {
    virtualIban.active = false;
    virtualIban.status = VirtualIbanStatus.DEACTIVATED;
    virtualIban.deactivatedAt = new Date();
    const deactivated = await manager.save(virtualIban);

    // Resolve ownership keys for intent lookup. currency/bank are eager; userData is not —
    // re-read under the same transaction when the caller did not preload relations.
    let userDataId = virtualIban.userData?.id;
    let currencyId = virtualIban.currency?.id;
    let bankId = virtualIban.bank?.id;
    let deactivatedIban = virtualIban.iban;

    if (userDataId == null || currencyId == null || bankId == null || deactivatedIban == null) {
      const owned = await manager.findOne(VirtualIban, {
        where: { id: virtualIban.id },
        relations: { userData: true, currency: true, bank: true },
      });
      if (!owned?.userData?.id || !owned?.currency?.id || !owned?.bank?.id || owned.iban == null) {
        this.logger.error(
          `Virtual IBAN ownership relations missing during deactivation (virtualIbanId=${virtualIban.id})`,
        );
        throw new Error(
          `Virtual IBAN ownership relations missing during deactivation (virtualIbanId=${virtualIban.id})`,
        );
      }
      userDataId = owned.userData.id;
      currencyId = owned.currency.id;
      bankId = owned.bank.id;
      deactivatedIban = owned.iban;
    }

    // Unconditional intent lookup (same lock pattern as getFrickIntentForUpdate). Missing row
    // is a natural no-op for non-Frick providers — do not throw, do not special-case by bank.
    const intent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId, currencyId, bankId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!intent) {
      // Non-Frick providers (e.g. Yapeal) have no issuance-intent row; deactivation is complete.
      return deactivated;
    }

    if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED && intent.externalIban === deactivatedIban) {
      // Matching Completed intent still points at this vIBAN — reopen with a fresh reference so
      // later requests cannot resolve to the dead IBAN forever.
      const newRequestReference = this.newFrickRequestReference();
      const message = (
        `virtual IBAN ${virtualIban.id} deactivated; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${intent.requestReference}; newRequestReference=${newRequestReference}`
      ).slice(0, 2000);

      await this.resetFrickIntentToPendingLocked(
        manager,
        intent,
        [VirtualIbanIssuanceIntentStatus.COMPLETED],
        message,
        true,
        newRequestReference,
      );
    } else if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED && intent.externalIban !== deactivatedIban) {
      // Historical Completed intent under the same (userData, currency, bank) triple already
      // reflects a different surviving vIBAN — leave it alone; deactivation of this row is fine.
      this.logger.info(
        `Issuance intent already COMPLETED for a different IBAN on virtual IBAN deactivation ` +
          `(virtualIbanId=${virtualIban.id}, intentId=${intent.id}, userDataId=${userDataId}, ` +
          `currencyId=${currencyId}, bankId=${bankId}, intentStatus=${intent.status})`,
      );
    } else {
      // PENDING / IN_FLIGHT / FAILED: this intent's current cycle has nothing to do with the vIBAN
      // being deactivated — only a COMPLETED intent can ever point at a live vIBAN. Benign, expected.
      this.logger.info(
        `Issuance intent non-terminal on virtual IBAN deactivation; leaving intent unchanged ` +
          `(virtualIbanId=${virtualIban.id}, intentId=${intent.id}, userDataId=${userDataId}, ` +
          `currencyId=${currencyId}, bankId=${bankId}, intentStatus=${intent.status})`,
      );
    }

    return deactivated;
  }

  /**
   * Account-merge ownership resolution for Frick issuance intents that had NO user-level vIBAN
   * dedup conflict (single-sided intents / pairs not present in `deactivations`).
   * Intents are not reachable via UserData @OneToMany, so merge reassignment never touches them otherwise.
   *
   * - No master intent for the same (currencyId, bankId): reassign the slave row to master.
   * - Master already has a row: unique index blocks reassignment — permanently merge-fail every
   *   non-COMPLETED slave intent (Pending/InFlight/Failed) via the event-logged transition path so
   *   reconciliation never reopens a pre-merge failure under the retired slave id. COMPLETED is left
   *   alone (runPhase1StuckIntents never loads Completed rows).
   *
   * Pairs already reconciled by {@link resolveMergedVirtualIbanPairLocked} are naturally safe to
   * re-visit: the loser-side intent is already FAILED with MERGE_SUPERSEDED_MARKER, so a second
   * failFrickIntentLocked is idempotent on the marker message; the winner-side intent has either been
   * reassigned off `slaveId` or already belongs to `masterId` so it is not returned by the slave
   * scan. No extra pair-key guard is required.
   */
  private async resolveIssuanceIntentsForMergeLocked(
    manager: EntityManager,
    masterId: number,
    slaveId: number,
  ): Promise<void> {
    const slaveIntents = await manager.find(VirtualIbanIssuanceIntent, {
      where: { userDataId: slaveId },
    });

    for (const slaveIntent of slaveIntents) {
      const masterIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
        where: {
          userDataId: masterId,
          currencyId: slaveIntent.currencyId,
          bankId: slaveIntent.bankId,
        },
      });

      if (!masterIntent) {
        // Ownership reassignment only — not a status transition, so no event log (same as bankDatas/etc.).
        await manager.update(VirtualIbanIssuanceIntent, slaveIntent.id, { userDataId: masterId });
        slaveIntent.userDataId = masterId;
        continue;
      }

      // COMPLETED is safe to leave alone: runPhase1StuckIntents only selects IN_FLIGHT/FAILED, so a
      // Completed historical row under the retired slave id is never reopened. FAILED must still be
      // merge-marked — without MERGE_SUPERSEDED_MARKER reconciliation would reopen it under a
      // userDataId that no longer exists after the merge.
      if (slaveIntent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) {
        continue;
      }

      const message = (
        `Superseded by account merge of userData ${slaveId} into ${masterId}; ${MERGE_SUPERSEDED_MARKER}; ` +
        `${CREATE_PATH_REFERENCE_MARKER}${slaveIntent.requestReference}`
      ).slice(0, 2000);

      await this.failFrickIntentLocked(manager, slaveIntent.id, message);
    }
  }

  /**
   * Per-(currency, bank) reconciliation after user-level vIBAN dedup during account merge.
   * Runs inside the caller's open transaction (no nested transaction).
   *
   * 1. Locate the single surviving active user-level winner for the pair across master|slave.
   * 2. Persist winner ownership onto masterId immediately (plain manager.update — no event log;
   *    mirrors the no-conflict intent reassignment style in resolveIssuanceIntentsForMergeLocked).
   *    Callers must not rely on a later userDataRepo.save(master) for this row — UserData.virtualIbans
   *    has no cascade, so that save does not reassign VirtualIban.userData.
   * 3. Reconcile both accounts' Frick intents for the pair: winner-side Completed stays Completed and
   *    moves to masterId; loser-side Pending/InFlight/Failed is permanently merge-failed (never left
   *    reopenable under a retired userDataId). COMPLETED non-winner historical rows stay untouched.
   */
  private async resolveMergedVirtualIbanPairLocked(
    manager: EntityManager,
    masterId: number,
    slaveId: number,
    currencyId: number,
    bankId: number,
  ): Promise<void> {
    const winners = await manager.find(VirtualIban, {
      where: [
        {
          userData: { id: masterId },
          currency: { id: currencyId },
          bank: { id: bankId },
          buy: IsNull(),
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
        {
          userData: { id: slaveId },
          currency: { id: currencyId },
          bank: { id: bankId },
          buy: IsNull(),
          active: true,
          status: VirtualIbanStatus.ACTIVE,
        },
      ],
      relations: { userData: true, currency: true, bank: true },
    });

    if (winners.length !== 1) {
      this.logger.error(
        `Account merge vIBAN dedup expected exactly one surviving winner ` +
          `(currencyId=${currencyId}, bankId=${bankId}, masterId=${masterId}, slaveId=${slaveId}, ` +
          `found=${winners.length})`,
      );
      throw new Error(
        `Account merge vIBAN dedup expected exactly one surviving winner ` +
          `(currencyId=${currencyId}, bankId=${bankId}, masterId=${masterId}, slaveId=${slaveId}, ` +
          `found=${winners.length})`,
      );
    }

    const winner = winners[0];
    if (winner.userData?.id !== masterId) {
      // Plain ownership move — not a status transition, so no event log (same style/reasoning as the
      // no-conflict intent reassignment in resolveIssuanceIntentsForMergeLocked).
      await manager.update(VirtualIban, winner.id, { userData: { id: masterId } });
      winner.userData = { id: masterId } as UserData;
    }

    const masterIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId: masterId, currencyId, bankId },
    });
    const slaveIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId: slaveId, currencyId, bankId },
    });

    // Winner-side intent is the one that legitimately completed onto the surviving vIBAN (whichever
    // account originally owned it). Missing intent rows (e.g. Yapeal) are a natural no-op.
    const pairIntents = [masterIntent, slaveIntent].filter(
      (intent): intent is VirtualIbanIssuanceIntent => intent != null,
    );
    const winnerIntent = pairIntents.find((intent) => intent.externalIban === winner.iban);

    for (const intent of pairIntents) {
      if (winnerIntent != null && intent.id === winnerIntent.id) continue;

      // PENDING / IN_FLIGHT / FAILED: permanently mark merge-superseded so runPhase1StuckIntents never
      // reopens a pre-merge failure under a retired userDataId. COMPLETED non-winner historical rows
      // are left untouched (reconciliation never loads Completed).
      if (
        intent.status === VirtualIbanIssuanceIntentStatus.PENDING ||
        intent.status === VirtualIbanIssuanceIntentStatus.IN_FLIGHT ||
        intent.status === VirtualIbanIssuanceIntentStatus.FAILED
      ) {
        const message = (
          `Superseded by account merge of userData ${slaveId} into ${masterId}; ${MERGE_SUPERSEDED_MARKER}; ` +
          `${CREATE_PATH_REFERENCE_MARKER}${intent.requestReference}`
        ).slice(0, 2000);
        await this.failFrickIntentLocked(manager, intent.id, message);
      }
    }

    if (winnerIntent != null && winnerIntent.userDataId !== masterId) {
      // Unique index (userDataId, currencyId, bankId): master may already hold the merge-failed loser
      // row for this pair. Park the winner, relocate the blocker onto the winner's previous owner,
      // then complete the move onto masterId. Plain ownership moves only — no event log.
      const blocking = await manager.findOne(VirtualIbanIssuanceIntent, {
        where: { userDataId: masterId, currencyId, bankId },
      });
      if (blocking != null && blocking.id !== winnerIntent.id) {
        const previousOwnerId = winnerIntent.userDataId;
        const parkUserDataId = -winnerIntent.id;
        await manager.update(VirtualIbanIssuanceIntent, winnerIntent.id, { userDataId: parkUserDataId });
        await manager.update(VirtualIbanIssuanceIntent, blocking.id, { userDataId: previousOwnerId });
        blocking.userDataId = previousOwnerId;
      }
      await manager.update(VirtualIbanIssuanceIntent, winnerIntent.id, { userDataId: masterId });
      winnerIntent.userDataId = masterId;
    }
  }

  /**
   * Atomically deactivates every superseded user-level personal IBAN, reassigns each surviving
   * winner onto masterId, reconciles both accounts' Frick issuance intents for every deduped
   * (currency, bank) pair, and dissolves remaining single-sided slave intents — all in a single
   * transaction/lock scope.
   *
   * Fixes the race where a concurrent customer request on the master account could miss the
   * still-slave-owned winner vIBAN, see only a reopened Pending master intent, and create a real
   * second Bank Frick account. A partial failure rolls back the whole sequence (atomicity over
   * partial progress). The caller's later, separate `userDataRepo.save(master)` must not be relied
   * upon for these rows (no cascade on UserData.virtualIbans) and does not need to change them.
   */
  async mergeUserLevelVirtualIbans(
    masterId: number,
    slaveId: number,
    deactivations: { virtualIban: VirtualIban; reason: string }[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // `reason` is retained on the deactivations element type for caller audit/documentation;
      // the locked helpers only mutate state.
      const losersByPair = new Map<string, { currencyId: number; bankId: number; losers: VirtualIban[] }>();

      for (const { virtualIban } of deactivations) {
        let currencyId = virtualIban.currency?.id;
        let bankId = virtualIban.bank?.id;
        if (currencyId == null || bankId == null) {
          const owned = await manager.findOne(VirtualIban, {
            where: { id: virtualIban.id },
            relations: { currency: true, bank: true },
          });
          if (owned?.currency?.id == null || owned?.bank?.id == null) {
            this.logger.error(
              `Virtual IBAN currency/bank missing during merge dedup (virtualIbanId=${virtualIban.id}, ` +
                `masterId=${masterId}, slaveId=${slaveId})`,
            );
            throw new Error(
              `Virtual IBAN currency/bank missing during merge dedup (virtualIbanId=${virtualIban.id}, ` +
                `masterId=${masterId}, slaveId=${slaveId})`,
            );
          }
          currencyId = owned.currency.id;
          bankId = owned.bank.id;
        }

        const key = `${currencyId}:${bankId}`;
        const group = losersByPair.get(key);
        if (group) group.losers.push(virtualIban);
        else losersByPair.set(key, { currencyId, bankId, losers: [virtualIban] });
      }

      for (const { currencyId, bankId, losers } of losersByPair.values()) {
        for (const loser of losers) {
          await this.deactivateVirtualIbanLocked(manager, loser);
        }
        await this.resolveMergedVirtualIbanPairLocked(manager, masterId, slaveId, currencyId, bankId);
      }

      // Single-sided pairs (no dedup conflict): reassign or fail remaining slave intents.
      // Already-resolved conflict pairs are naturally safe — see resolveIssuanceIntentsForMergeLocked.
      await this.resolveIssuanceIntentsForMergeLocked(manager, masterId, slaveId);
    });
    this.virtualIbanRepo.invalidateCache();
  }

  private hasProviderForCurrency(currencyName: string): boolean {
    return this.genericProviders.some(
      (provider) => provider.isAvailable() && provider.currencies.includes(currencyName),
    );
  }

  private getProvider(currencyName: string): VibanProvider {
    const provider = this.genericProviders.find(
      (candidate) => candidate.isAvailable() && candidate.currencies.includes(currencyName),
    );
    if (!provider) throw new BadRequestException('No personal IBAN provider available for this currency');
    return provider;
  }
}
