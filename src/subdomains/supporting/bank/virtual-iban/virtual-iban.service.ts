import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { Bank } from '../bank/bank.entity';
import { BankService } from '../bank/bank.service';
import { IbanBankName } from '../bank/dto/bank.dto';
import { FrickVibanProvider } from './providers/frick-viban.provider';
import { VibanAccountHolder } from './providers/viban-account-holder.enum';
import { ReservedViban, VibanNotCreatedError, VibanProvider } from './providers/viban-provider.interface';
import { YapealVibanProvider } from './providers/yapeal-viban.provider';
import { VirtualIbanIssuanceEvent } from './virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntentStatus } from './virtual-iban-issuance-intent-status.enum';
import { VirtualIbanIssuanceIntent } from './virtual-iban-issuance-intent.entity';
import { VirtualIbanLifecycleEvent } from './virtual-iban-lifecycle-event.entity';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

/**
 * Sentinel returned by {@link VirtualIbanService.findAndFinalizeFrickIssuance} when the Frick listing
 * call succeeded and proved zero matches for the intent's requestReference. Distinct from a thrown
 * error (listing itself failed / ambiguous) and from a finalized VirtualIban (match found).
 */
const FrickRecoveryNotFound = Symbol('FrickRecoveryNotFound');
const MERGED_USER_DATA_PREFIX = 'Merged into ';
const MAX_OWNERSHIP_TRANSITIONS = 100;

type IssuanceIntegrityDetails = {
  intentId: number;
  userDataId: number;
  currencyId: number;
  bankId: number;
};

class IssuanceIntegrityError extends Error {
  constructor(
    readonly reason: string,
    readonly details: IssuanceIntegrityDetails,
    readonly resultError: Error,
  ) {
    super(resultError.message);
  }
}

/**
 * Prefixes written into issuance-event `nextError` when a Frick requestReference is retired.
 * Current writers are deactivation reopen and account-merge supersede (via
 * CREATE_PATH_REFERENCE_MARKER co-located in the merge-fail message). Historical reconciliation
 * events may also contain either marker. Request-path issuance never retires references on its own.
 * Phase 2 of the reconciliation job parses these markers; keep writer and parser on the same constants.
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
   * Longest local window from intent claim through create processing: authorization preflight
   * (30s) plus create, re-authorization, and one retried create request (90s).
   */
  static readonly FRICK_CREATE_MAX_PROCESSING_MS = 120_000;

  /** Providers eligible for implicit/default personal-IBAN behavior, selected by their supported currency. */
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
    this.genericProviders = [this.yapealVibanProvider, this.frickVibanProvider];
  }

  isUserEligible(currencyName: string, userData: UserData): boolean {
    return this.hasProviderForCurrency(currencyName) && userData.kycLevel >= KycLevel.LEVEL_50;
  }

  /**
   * Resolves who legally holds the deposit account behind a personal-IBAN bank name (see
   * {@link VibanAccountHolder}). This is the seam that lets buildVirtualIbanResponse (buy.service.ts) —
   * which only has the persisted VirtualIban row, never the VibanProvider instance that issued it — ask
   * "who owns this account" without threading provider objects through the entity layer. It deliberately
   * resolves the persisted bank name against every registered provider. Fail-closed: an unrecognized bank
   * name must never silently default to either party's identity — a wrong default here means showing the
   * wrong recipient name on a real bank transfer.
   */
  getAccountHolder(bankName: IbanBankName): VibanAccountHolder {
    const provider = [this.yapealVibanProvider, this.frickVibanProvider].find((p) => p.bankName === bankName);
    if (!provider) throw new Error(`No viban provider registered for bank ${bankName}`);
    return provider.accountHolder;
  }

  /** Finds the active user-level personal IBAN, including Bank Frick as the regular EUR provider. */
  async getActiveForUserAndCurrency(userData: UserData, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOne({
      where: {
        userData: { id: userData.id },
        currency: { name: currencyName },
        // A customer can hold several active rows for one currency - e.g. an old Yapeal EUR IBAN
        // alongside a newer Frick one. Rows whose bank no longer receives must not be returned: this
        // is a findOne without an ORDER BY, so a retired row can win over a working one, and the
        // caller then sees "IBAN found, bank does not receive" and gives up. Since the collection
        // account is no longer a fallback, that surfaced as PersonalIbanIssuanceFailed for every
        // customer holding a retired Yapeal EUR IBAN.
        bank: { receive: true },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
      relations: { bank: true },
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

    // createVirtualIban calls reserveViban without a description, which the Frick provider rejects
    // outright - and it carries none of the claim/recovery protocol Frick issuance needs. Route the
    // Frick currencies to their own entry point instead of letting them reach the generic path.
    if (this.frickVibanProvider.currencies.includes(currencyName))
      return this.getOrCreateFrickForUser(userData, currencyName);

    return this.createVirtualIban(userData, currencyName);
  }

  async createForBuy(userData: UserData, buy: Buy, currencyName: string): Promise<VirtualIban> {
    const existingForBuy = await this.getActiveForBuyAndCurrency(buy.id, currencyName);
    if (existingForBuy) throw new ConflictException('Buy already has an active personal IBAN for this currency');

    // No buy-specific equivalent of the Frick claim/recovery protocol exists, and the generic path
    // would fail at reserveViban anyway. Refuse rather than issue through it; BuyService skips this
    // step for Frick currencies, so this guards direct callers. Checked after the conflict lookup so
    // an already-issued IBAN still reports a conflict, as it did before Frick joined the providers.
    if (this.frickVibanProvider.currencies.includes(currencyName))
      throw new BadRequestException('Buy-specific personal IBANs are not available for this currency');

    return this.createVirtualIban(userData, currencyName, buy);
  }

  /**
   * Issuance path for providers without their own protocol - Yapeal today. Bank Frick never reaches
   * here: both its entry points (explicit selector and implicit EUR resolution) go through
   * getOrCreateFrickForUser, because this path neither takes the claim/recovery route nor passes the
   * description Frick requires. Yapeal must not be routed through that Frick-specific machinery either.
   */
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
   * Fail-closed, cross-instance-safe Frick issuance. Used by BOTH entry points: the explicit
   * personal-IBAN selector and the implicit EUR resolution, which routes here rather than through the
   * generic createVirtualIban path.
   */
  async getOrCreateFrickForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    if (currencyName !== 'EUR') throw new BadRequestException(QuoteError.PERSONAL_IBAN_CURRENCY_NOT_SUPPORTED);

    if (!this.frickVibanProvider.isAvailable()) {
      this.logger.error('Bank Frick virtual IBAN service is not available');
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    const initial = await this.withUserLevelIssuanceLock(
      userData.id,
      currencyName,
      this.frickVibanProvider.bankName,
      (manager, currentUserData) => this.initializeFrickForUserLocked(manager, currentUserData, currencyName),
    );
    if (initial.existing) return initial.existing;
    if (!initial.claimed)
      return this.resolveExistingFrickIntent(initial.intent, initial.userData, initial.bank, initial.currency);
    return this.issueClaimedFrickIntent(initial.intent, initial.userData, initial.bank, initial.currency);
  }

  /**
   * Cross-instance serialization shared by issuance ownership setup and account merge.
   * The transaction-scoped lock is acquired through the same manager as every protected read/write.
   * A merged owner is followed only after the current transaction releases its lock, keeping lock
   * ordering compatible with merge's globally sorted acquisition order.
   */
  private async withUserLevelIssuanceLock<T>(
    userDataId: number,
    currencyName: string,
    bankName: IbanBankName,
    operation: (manager: EntityManager, userData: UserData) => Promise<T>,
  ): Promise<T> {
    const namespace = `virtual-iban-issuance:${bankName}:${currencyName}`;
    const visitedUserDataIds = new Set<number>();
    let currentUserDataId = userDataId;

    for (;;) {
      if (visitedUserDataIds.size >= MAX_OWNERSHIP_TRANSITIONS) {
        throw new Error(
          `Merged UserData ownership exceeds ${MAX_OWNERSHIP_TRANSITIONS} transitions while issuing a virtual IBAN`,
        );
      }
      if (visitedUserDataIds.has(currentUserDataId)) {
        throw new Error(`Cyclic merged UserData ownership while issuing a virtual IBAN (${currentUserDataId})`);
      }
      visitedUserDataIds.add(currentUserDataId);

      const result = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          namespace,
          String(currentUserDataId),
        ]);
        const currentUserData = await manager.getRepository(UserData).findOne({ where: { id: currentUserDataId } });
        if (!currentUserData) throw new BadRequestException('User data not found');

        if (currentUserData.status === UserDataStatus.MERGED) {
          const nextUserDataId = Number(currentUserData.firstname?.replace(MERGED_USER_DATA_PREFIX, ''));
          if (
            !currentUserData.firstname?.startsWith(MERGED_USER_DATA_PREFIX) ||
            !Number.isSafeInteger(nextUserDataId) ||
            nextUserDataId <= 0
          ) {
            throw new Error(`Merged UserData ${currentUserData.id} has no valid surviving owner`);
          }
          return { nextUserDataId } as const;
        }

        return { value: await operation(manager, currentUserData) } as const;
      });

      if ('value' in result) return result.value;
      currentUserDataId = result.nextUserDataId;
    }
  }

  private async initializeFrickForUserLocked(
    manager: EntityManager,
    userData: UserData,
    currencyName: string,
  ): Promise<{
    userData: UserData;
    currency: Fiat;
    bank: Bank;
    intent: VirtualIbanIssuanceIntent;
    existing: VirtualIban | null;
    claimed: boolean;
  }> {
    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException(QuoteError.KYC_REQUIRED);

    const currency = await this.fiatService.getFiatByName(currencyName, manager);
    if (!currency) throw new BadRequestException(QuoteError.CURRENCY_UNSUPPORTED);

    const bank = await this.bankService.getBankInternal(IbanBankName.FRICK, currencyName, manager);
    if (!bank?.receive) throw new BadRequestException(QuoteError.NO_BANK_AVAILABLE_FOR_THIS_CURRENCY);

    const initial = await this.initializeFrickIntent(manager, userData, bank, currency);
    this.assertFrickReferenceAccountSnapshot(initial.intent, bank);
    if (initial.existing || initial.intent.status !== VirtualIbanIssuanceIntentStatus.PENDING) {
      return { userData, currency, bank, ...initial, claimed: false };
    }

    const intent = await this.transitionFrickIntent(
      manager,
      initial.intent,
      VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      initial.intent.externalIban,
      null,
    );
    return { userData, currency, bank, intent, existing: null, claimed: true };
  }

  /**
   * Acquires every Frick/currency lock that can issue onto either side of an account merge.
   * Yapeal retains its merge-base behavior and never enters this Frick recovery protocol.
   * Keys are globally sorted to make concurrent/reversed merge attempts deadlock-safe.
   * After every key is held, any intent state from which an external effect can still arrive blocks
   * the merge. The explicit state list below documents those externally live states.
   */
  async lockUserLevelIssuanceForMerge(masterId: number, slaveId: number, manager: EntityManager): Promise<void> {
    const keys = [
      ...new Set(
        this.frickVibanProvider.currencies.flatMap((currencyName) =>
          [masterId, slaveId].map((userDataId) => ({
            namespace: `virtual-iban-issuance:${this.frickVibanProvider.bankName}:${currencyName}`,
            owner: String(userDataId),
          })),
        ),
      ),
    ];
    keys.sort((a, b) => `${a.namespace}:${a.owner}`.localeCompare(`${b.namespace}:${b.owner}`));

    for (const { namespace, owner } of keys) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [namespace, owner]);
    }

    const externallyLiveStatuses = [
      // The committed claim may be between provider preflight, create, activation, and local finalization.
      VirtualIbanIssuanceIntentStatus.IN_FLIGHT,
      // Ambiguous create/activation failures remain recoverable, and request-path recovery performs
      // listing plus activation outside the lock before returning to local finalization.
      VirtualIbanIssuanceIntentStatus.FAILED,
    ];
    const externallyLiveIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: {
        userDataId: In([masterId, slaveId]),
        provider: IbanBankName.FRICK,
        status: In(externallyLiveStatuses),
      },
      order: { id: 'ASC' },
    });
    if (externallyLiveIntent) {
      this.logger.info(
        `Account merge deferred for externally live Bank Frick personal IBAN issuance ` +
          `(intentId=${externallyLiveIntent.id}, status=${externallyLiveIntent.status}, ` +
          `masterId=${masterId}, slaveId=${slaveId})`,
      );
      throw new ServiceUnavailableException(
        'Account merge is temporarily blocked by externally live personal IBAN issuance; retry after it is reconciled',
      );
    }
  }

  /**
   * Regular Frick issuance path after the intent was durably claimed under the advisory lock.
   * Provider preflight and reservation both run after that transaction committed.
   */
  private async issueClaimedFrickIntent(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban> {
    const referenceAccountIban = intent.referenceAccountIban;
    try {
      await this.frickVibanProvider.prepareVibanReservation(referenceAccountIban, intent.requestReference);
    } catch (error) {
      await this.resetFrickIntentToPending(
        intent.id,
        intent.requestReference,
        'Bank Frick virtual IBAN preflight failed',
      );
      this.logger.error(
        `Bank Frick personal IBAN preflight failed (intentId=${intent.id}, userDataId=${userData.id}, ` +
          `currencyId=${currency.id}, bankId=${bank.id})`,
        error instanceof Error ? error : undefined,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }

    // No database connection is held across Bank Frick I/O. While an intent remains InFlight/Failed,
    // retries can only reconcile the exact technical description and never issue another POST.
    // An empty recovery listing is NOT proof of non-existence (another process may still be mid-flight);
    // that case fails closed and leaves the intent for the hourly reconciliation job.
    return this.reserveAndFinalizeFrickIssuance(intent, userData, bank, currency);
  }

  private async reserveAndFinalizeFrickIssuance(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban> {
    try {
      const reserved = await this.frickVibanProvider.reserveViban(intent.referenceAccountIban, intent.requestReference);
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
      // (InFlight) — no reset, no reference rotation, no second POST. Hourly reconciliation only
      // alerts on positive matches or unproven absence; it never reopens the intent.
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

  private async initializeFrickIntent(
    manager: EntityManager,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<{ intent: VirtualIbanIssuanceIntent; existing: VirtualIban | null }> {
    await manager.query(
      `INSERT INTO "virtual_iban_issuance_intent"
          ("requestReference", "userDataId", "currencyId", "bankId", "provider",
           "referenceAccountIban", "referenceAccountReceive", "buyId", "status", "externalIban", "error")
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, NULL, NULL)
         ON CONFLICT DO NOTHING`,
      [
        this.newFrickRequestReference(),
        userData.id,
        currency.id,
        bank.id,
        IbanBankName.FRICK,
        bank.iban,
        bank.receive,
        VirtualIbanIssuanceIntentStatus.PENDING,
      ],
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
    const match = await this.frickVibanProvider.findRecoverableByDescription(
      intent.requestReference,
      intent.referenceAccountIban,
    );
    if (!match) return FrickRecoveryNotFound;

    const reserved = await this.frickVibanProvider.adoptAndActivate(
      match,
      intent.referenceAccountIban,
      intent.requestReference,
    );
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
    let virtualIban: VirtualIban;
    try {
      virtualIban = await this.withUserLevelIssuanceLock(
        userData.id,
        currency.name,
        this.frickVibanProvider.bankName,
        async (manager, lockedOwner) => {
          const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);
          const details = {
            intentId: intent.id,
            userDataId: intent.userDataId,
            currencyId: intent.currencyId,
            bankId: intent.bankId,
          };

          if (intent.requestReference !== expectedRequestReference) {
            this.logger.error(
              `Bank Frick finalize refused: requestReference changed under lock ` +
                `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id})`,
            );
            throw new IssuanceIntegrityError(
              'finalize: requestReference changed under lock',
              details,
              new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
            );
          }

          if (
            intent.currencyId !== currency.id ||
            intent.bankId !== bank.id ||
            intent.buyId != null ||
            intent.userDataId !== lockedOwner.id
          ) {
            this.logger.error(
              `Bank Frick finalize refused: intent ownership changed under lock ` +
                `(intentId=${intent.id}, suppliedUserDataId=${userData.id}, suppliedCurrencyId=${currency.id}, ` +
                `suppliedBankId=${bank.id}, intentUserDataId=${intent.userDataId}, ` +
                `intentCurrencyId=${intent.currencyId}, intentBankId=${intent.bankId})`,
            );
            throw new IssuanceIntegrityError(
              'finalize: intent ownership changed under lock',
              details,
              new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
            );
          }

          if (
            intent.userDataId !== userData.id &&
            !(await this.hasOrderedOwnershipPath(manager, intent, userData.id, intent.userDataId))
          ) {
            this.logger.error(
              `Bank Frick finalize refused: intent owner changed without a matching merge audit event ` +
                `(intentId=${intent.id}, suppliedUserDataId=${userData.id}, intentUserDataId=${intent.userDataId}, ` +
                `currencyId=${intent.currencyId}, bankId=${intent.bankId})`,
            );
            throw new IssuanceIntegrityError(
              'finalize: intent ownership changed without merge audit',
              details,
              new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
            );
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
            throw new IssuanceIntegrityError(
              'finalize: intent was terminated by an account merge',
              details,
              new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
            );
          }

          if (intent.externalIban && intent.externalIban !== reserved.iban) {
            this.logger.error(
              `Bank Frick issuance intent conflicts with the recovered personal IBAN ` +
                `(intentId=${intent.id}, userDataId=${userData.id}, currencyId=${currency.id}, bankId=${bank.id}, ` +
                `ibanMismatch=true)`,
            );
            throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
          }

          const currentBank = await manager.findOne(Bank, { where: { id: intent.bankId } });
          try {
            this.assertFrickReferenceAccountSnapshot(intent, currentBank);
          } catch {
            throw new IssuanceIntegrityError(
              'finalize: reference-account configuration changed after intent claim',
              details,
              new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
            );
          }

          const persisted = await this.persistUserLevelIfMissing(manager, lockedOwner, currentBank, currency, reserved);
          await this.transitionFrickIntent(
            manager,
            intent,
            VirtualIbanIssuanceIntentStatus.COMPLETED,
            reserved.iban,
            null,
          );
          return persisted;
        },
      );
    } catch (error) {
      if (error instanceof IssuanceIntegrityError) {
        await this.sendReferenceIntegrityAlert(error.reason, error.details);
        throw error.resultError;
      }
      throw error;
    }
    this.virtualIbanRepo.invalidateCache();
    return virtualIban;
  }

  private assertFrickReferenceAccountSnapshot(
    intent: VirtualIbanIssuanceIntent,
    bank: Bank | null | undefined,
  ): asserts bank is Bank {
    if (
      intent.provider !== IbanBankName.FRICK ||
      intent.referenceAccountReceive !== true ||
      !intent.referenceAccountIban ||
      bank?.name !== intent.provider ||
      bank.iban !== intent.referenceAccountIban ||
      bank.receive !== intent.referenceAccountReceive
    ) {
      this.logger.error(
        `Bank Frick reference-account snapshot mismatch ` +
          `(intentId=${intent.id}, userDataId=${intent.userDataId}, currencyId=${intent.currencyId}, ` +
          `bankId=${intent.bankId})`,
      );
      throw new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);
    }
  }

  private async hasOrderedOwnershipPath(
    manager: EntityManager,
    intent: VirtualIbanIssuanceIntent,
    previousUserDataId: number,
    nextUserDataId: number,
  ): Promise<boolean> {
    const events = (await manager.query(
      `SELECT "previousUserDataId", "nextUserDataId"
         FROM "virtual_iban_issuance_event"
        WHERE "intentId" = $1
          AND "currencyId" = $2
          AND "bankId" = $3
          AND "previousUserDataId" <> "nextUserDataId"
        ORDER BY "id" ASC
        LIMIT $4`,
      [intent.id, intent.currencyId, intent.bankId, MAX_OWNERSHIP_TRANSITIONS + 1],
    )) as Pick<VirtualIbanIssuanceEvent, 'previousUserDataId' | 'nextUserDataId'>[];
    const details = {
      intentId: intent.id,
      userDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
    };
    if (events.length > MAX_OWNERSHIP_TRANSITIONS) {
      throw new IssuanceIntegrityError(
        'finalize: ownership history exceeds maximum',
        details,
        new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
      );
    }

    let currentUserDataId = previousUserDataId;
    const visitedUserDataIds = new Set([currentUserDataId]);
    for (const event of events) {
      if (event.previousUserDataId !== currentUserDataId) continue;
      if (visitedUserDataIds.has(event.nextUserDataId)) {
        throw new IssuanceIntegrityError(
          'finalize: cyclic ownership history',
          details,
          new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
        );
      }
      currentUserDataId = event.nextUserDataId;
      visitedUserDataIds.add(currentUserDataId);
      if (currentUserDataId === nextUserDataId) return true;
    }
    return false;
  }

  private async failFrickIntent(intentId: number, message: string): Promise<void> {
    try {
      await this.dataSource.transaction((manager) => this.failFrickIntentLocked(manager, intentId, message));
    } catch (error) {
      await this.reportIntegrityError(error);
      throw error instanceof IssuanceIntegrityError ? error.resultError : error;
    }
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
    try {
      await this.dataSource.transaction(async (manager) => {
        const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);

        if (intent.requestReference !== expectedRequestReference) {
          this.logger.error(
            `Bank Frick reset refused: requestReference changed under lock ` +
              `(intentId=${intent.id}, userDataId=${intent.userDataId}, currencyId=${intent.currencyId}, bankId=${intent.bankId})`,
          );
          throw new IssuanceIntegrityError(
            'reset: requestReference changed under lock',
            {
              intentId: intent.id,
              userDataId: intent.userDataId,
              currencyId: intent.currencyId,
              bankId: intent.bankId,
            },
            new ServiceUnavailableException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED),
          );
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
    } catch (error) {
      await this.reportIntegrityError(error);
      throw error instanceof IssuanceIntegrityError ? error.resultError : error;
    }
  }

  private async sendReferenceIntegrityAlert(reason: string, details: IssuanceIntegrityDetails): Promise<void> {
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

  async reportIntegrityError(error: unknown): Promise<void> {
    if (error instanceof IssuanceIntegrityError) {
      await this.sendReferenceIntegrityAlert(error.reason, error.details);
    }
  }

  /**
   * Shared reset-to-Pending for Frick issuance intents (request path and deactivation).
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
      previousUserDataId: intent.userDataId,
      nextUserDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
    };
    const event = manager.create(VirtualIbanIssuanceEvent, {
      intentId: intent.id,
      userDataId: intent.userDataId,
      previousUserDataId: intent.userDataId,
      nextUserDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
      provider: intent.provider,
      referenceAccountIban: intent.referenceAccountIban,
      referenceAccountReceive: intent.referenceAccountReceive,
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
   * A genuine miss means the transition cannot preserve a non-null prior IBAN in the append-only
   * audit record. Alert and throw so the enclosing transaction retains the intent snapshot unchanged.
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
    throw new IssuanceIntegrityError(
      'resolveVirtualIbanId: genuine miss — no VirtualIban row for stored IBAN',
      intentIds,
      new Error(
        `Cannot transition Frick issuance intent ${intentIds.intentId}: stored external IBAN has no VirtualIban row`,
      ),
    );
  }

  private async reassignFrickIntentLocked(
    manager: EntityManager,
    intent: VirtualIbanIssuanceIntent,
    nextUserDataId: number,
  ): Promise<void> {
    if (intent.userDataId === nextUserDataId) return;

    const intentIds = {
      intentId: intent.id,
      userDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
    };
    const virtualIbanId = await this.resolveVirtualIbanId(manager, intent.externalIban, intentIds);
    const event = manager.create(VirtualIbanIssuanceEvent, {
      intentId: intent.id,
      userDataId: intent.userDataId,
      previousUserDataId: intent.userDataId,
      nextUserDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
      provider: intent.provider,
      referenceAccountIban: intent.referenceAccountIban,
      referenceAccountReceive: intent.referenceAccountReceive,
      previousStatus: intent.status,
      nextStatus: intent.status,
      previousVirtualIbanId: virtualIbanId,
      nextVirtualIbanId: virtualIbanId,
      previousError: intent.error,
      nextError: intent.error,
    });
    await manager.save(event);
    await manager.update(VirtualIbanIssuanceIntent, intent.id, { userDataId: nextUserDataId });
    intent.userDataId = nextUserDataId;
  }

  private async recordVirtualIbanLifecycleEventLocked(
    manager: EntityManager,
    virtualIban: VirtualIban,
    next: {
      userDataId: number;
      active: boolean;
      status: VirtualIbanStatus | null | undefined;
      deactivatedAt: Date | null | undefined;
    },
    reason: string,
  ): Promise<void> {
    const previousUserDataId = virtualIban.userData?.id;
    if (previousUserDataId == null) {
      throw new Error(`Virtual IBAN owner missing for lifecycle audit (virtualIbanId=${virtualIban.id})`);
    }
    if (!reason.trim()) throw new Error(`Virtual IBAN lifecycle reason missing (virtualIbanId=${virtualIban.id})`);

    const event = manager.create(VirtualIbanLifecycleEvent, {
      virtualIbanId: virtualIban.id,
      previousUserDataId,
      nextUserDataId: next.userDataId,
      previousActive: virtualIban.active,
      nextActive: next.active,
      // VirtualIban models nullable SQL columns as optional properties. Convert that legacy
      // representation explicitly so the audit records the actual NULL state.
      previousStatus: virtualIban.status === undefined ? null : virtualIban.status,
      nextStatus: next.status === undefined ? null : next.status,
      previousDeactivatedAt: virtualIban.deactivatedAt === undefined ? null : virtualIban.deactivatedAt,
      nextDeactivatedAt: next.deactivatedAt === undefined ? null : next.deactivatedAt,
      transitionedAt: new Date(),
      reason,
    });
    await manager.save(event);
  }

  private async getFrickIntentForUpdate(
    manager: EntityManager,
    userDataId: number,
    currencyId: number,
    bankId: number,
  ): Promise<VirtualIbanIssuanceIntent> {
    const intent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId, currencyId, bankId, provider: IbanBankName.FRICK, buyId: IsNull() },
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
      where: { id, provider: IbanBankName.FRICK },
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

  /** Exact buy-bound lookup retained from the implicit Yapeal path. */
  async getActiveForBuyAndCurrency(buyId: number, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOne({
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
    return this.virtualIbanRepo.findOne({
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

  async getVirtualIbansForAccount(userDataId: number, manager?: EntityManager): Promise<VirtualIban[]> {
    if (manager)
      return manager.find(VirtualIban, {
        where: { userData: { id: userDataId } },
        relations: { userData: true, currency: true, bank: true, buy: true },
      });
    return this.virtualIbanRepo.findCachedBy(`user-${userDataId}`, { userData: { id: userDataId } });
  }

  async getFrickVirtualIbansForAccount(userDataId: number, manager: EntityManager): Promise<VirtualIban[]> {
    return manager.find(VirtualIban, {
      where: { userData: { id: userDataId }, bank: { name: IbanBankName.FRICK } },
      relations: { userData: true, currency: true, bank: true, buy: true },
    });
  }

  private async deactivateVirtualIbanLocked(
    manager: EntityManager,
    virtualIban: VirtualIban,
    reason: string,
  ): Promise<VirtualIban> {
    // Resolve ownership keys for intent lookup. currency/bank are eager; userData is not —
    // re-read under the same transaction before audit when the caller did not preload relations.
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
      virtualIban = owned;
    }

    const deactivatedAt = new Date();
    await this.recordVirtualIbanLifecycleEventLocked(
      manager,
      virtualIban,
      {
        userDataId,
        active: false,
        status: VirtualIbanStatus.DEACTIVATED,
        deactivatedAt,
      },
      reason,
    );
    virtualIban.active = false;
    virtualIban.status = VirtualIbanStatus.DEACTIVATED;
    virtualIban.deactivatedAt = deactivatedAt;
    const deactivated = await manager.save(virtualIban);

    // Yapeal and every other implicit provider stop here. Retirement markers and issuance-intent
    // transitions are meaningful only for Frick's reference-reconciliation protocol.
    if (virtualIban.bank.name !== IbanBankName.FRICK) return deactivated;

    const intent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId, currencyId, bankId, provider: IbanBankName.FRICK, buyId: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });

    if (!intent) return deactivated;

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
   *   alert-only reconciliation never treats a pre-merge failure under the retired slave id as
   *   eligible work. COMPLETED is left alone (runPhase1StuckIntents never loads Completed rows).
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
      where: { userDataId: slaveId, provider: IbanBankName.FRICK },
    });

    for (const slaveIntent of slaveIntents) {
      const masterIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
        where: {
          userDataId: masterId,
          currencyId: slaveIntent.currencyId,
          bankId: slaveIntent.bankId,
          provider: IbanBankName.FRICK,
          buyId: slaveIntent.buyId ?? IsNull(),
        },
      });

      if (!masterIntent) {
        await this.reassignFrickIntentLocked(manager, slaveIntent, masterId);
        continue;
      }

      // COMPLETED is safe to leave alone: runPhase1StuckIntents only selects IN_FLIGHT/FAILED.
      // FAILED must still be merge-marked so alert-only reconciliation excludes the retired
      // userDataId from listing and absence alerts after the merge.
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
   * 2. Append the winner ownership transition, then persist it onto masterId immediately.
   *    Callers must not rely on a later userDataRepo.save(master) for this row —
   *    UserData.virtualIbans has no cascade, so that save does not reassign VirtualIban.userData.
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
      await this.recordVirtualIbanLifecycleEventLocked(
        manager,
        winner,
        {
          userDataId: masterId,
          active: winner.active,
          status: winner.status,
          deactivatedAt: winner.deactivatedAt,
        },
        `Reassigned surviving virtual IBAN ${winner.id} during account merge ` +
          `(master ${masterId}, slave ${slaveId})`,
      );
      await manager.update(VirtualIban, winner.id, { userData: { id: masterId } });
      winner.userData = { id: masterId } as UserData;
    }

    const masterIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId: masterId, currencyId, bankId, provider: IbanBankName.FRICK, buyId: IsNull() },
    });
    const slaveIntent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { userDataId: slaveId, currencyId, bankId, provider: IbanBankName.FRICK, buyId: IsNull() },
    });

    // Winner-side intent is the one that legitimately completed onto the surviving Frick vIBAN.
    const pairIntents = [masterIntent, slaveIntent].filter(
      (intent): intent is VirtualIbanIssuanceIntent => intent != null,
    );
    const winnerIntent = pairIntents.find((intent) => intent.externalIban === winner.iban);

    for (const intent of pairIntents) {
      if (winnerIntent != null && intent.id === winnerIntent.id) continue;

      // PENDING / IN_FLIGHT / FAILED: permanently mark merge-superseded so runPhase1StuckIntents
      // excludes the retired userDataId from its alert-only checks. COMPLETED non-winner historical
      // rows are left untouched (reconciliation never loads Completed).
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
      // then complete the move onto masterId. Each intermediate and final ownership move appends its
      // own issuance event before updating the intent snapshot.
      const blocking = await manager.findOne(VirtualIbanIssuanceIntent, {
        where: { userDataId: masterId, currencyId, bankId, provider: IbanBankName.FRICK, buyId: IsNull() },
      });
      if (blocking != null && blocking.id !== winnerIntent.id) {
        const previousOwnerId = winnerIntent.userDataId;
        const parkUserDataId = -winnerIntent.id;
        await this.reassignFrickIntentLocked(manager, winnerIntent, parkUserDataId);
        await this.reassignFrickIntentLocked(manager, blocking, previousOwnerId);
      }
      await this.reassignFrickIntentLocked(manager, winnerIntent, masterId);
    }
  }

  /**
   * Atomically deactivates every superseded user-level personal IBAN, reassigns each surviving
   * winner onto masterId, reconciles both accounts' Frick issuance intents for every deduped
   * (currency, bank) pair, and dissolves remaining single-sided slave intents — all in a single
   * transaction/lock scope supplied by the account-merge caller.
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
    manager: EntityManager,
  ): Promise<void> {
    const losersByPair = new Map<
      string,
      {
        currencyId: number;
        bankId: number;
        losers: { virtualIban: VirtualIban; reason: string }[];
      }
    >();

    for (const deactivation of deactivations.filter(
      ({ virtualIban }) => virtualIban.bank?.name === IbanBankName.FRICK,
    )) {
      const { virtualIban } = deactivation;
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
      if (group) group.losers.push(deactivation);
      else losersByPair.set(key, { currencyId, bankId, losers: [deactivation] });
    }

    for (const { currencyId, bankId, losers } of losersByPair.values()) {
      for (const { virtualIban, reason } of losers) {
        await this.deactivateVirtualIbanLocked(manager, virtualIban, reason);
      }
      await this.resolveMergedVirtualIbanPairLocked(manager, masterId, slaveId, currencyId, bankId);
    }

    const survivingSlaveVirtualIbans = await manager.find(VirtualIban, {
      where: { userData: { id: slaveId }, bank: { name: IbanBankName.FRICK } },
      relations: { userData: true, bank: true },
    });
    for (const surviving of survivingSlaveVirtualIbans) {
      await this.recordVirtualIbanLifecycleEventLocked(
        manager,
        surviving,
        {
          userDataId: masterId,
          active: surviving.active,
          status: surviving.status,
          deactivatedAt: surviving.deactivatedAt,
        },
        `Reassigned virtual IBAN ${surviving.id} during account merge (master ${masterId}, slave ${slaveId})`,
      );
      await manager.update(VirtualIban, surviving.id, { userData: { id: masterId } });
      surviving.userData = { id: masterId } as UserData;
    }

    // Single-sided pairs (no dedup conflict): reassign or fail remaining slave intents.
    // Already-resolved conflict pairs are naturally safe — see resolveIssuanceIntentsForMergeLocked.
    await this.resolveIssuanceIntentsForMergeLocked(manager, masterId, slaveId);
  }

  invalidateCacheAfterMerge(): void {
    this.virtualIbanRepo.invalidateCache();
  }

  /**
   * Whether any provider covers this currency at all, regardless of whether it is reachable right now.
   * Kept apart from {@link hasProviderForCurrency} on purpose: "we do not offer personal IBANs in this
   * currency" is a permanent answer the customer can act on, while an outage is temporary and ours to
   * fix. Folding the two together would tell someone their currency is unsupported during a blip.
   */
  supportsCurrency(currencyName: string): boolean {
    return this.genericProviders.some((provider) => provider.currencies.includes(currencyName));
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
