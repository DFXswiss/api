import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { Bank } from '../bank/bank.entity';
import { BankService } from '../bank/bank.service';
import { IbanBankName } from '../bank/dto/bank.dto';
import { FrickVibanProvider } from './providers/frick-viban.provider';
import { ReservedViban, VibanProvider } from './providers/viban-provider.interface';
import { YapealVibanProvider } from './providers/yapeal-viban.provider';
import { VirtualIbanIssuanceEvent } from './virtual-iban-issuance-event.entity';
import { VirtualIbanIssuanceIntent, VirtualIbanIssuanceIntentStatus } from './virtual-iban-issuance-intent.entity';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

@Injectable()
export class VirtualIbanService {
  /** Providers eligible for implicit/default personal-IBAN behavior. Frick is explicit opt-in only. */
  private readonly genericProviders: VibanProvider[];

  constructor(
    private readonly virtualIbanRepo: VirtualIbanRepository,
    private readonly bankService: BankService,
    private readonly fiatService: FiatService,
    private readonly yapealVibanProvider: YapealVibanProvider,
    private readonly frickVibanProvider: FrickVibanProvider,
    private readonly dataSource: DataSource,
  ) {
    this.genericProviders = [this.yapealVibanProvider];
  }

  isUserEligible(currencyName: string, userData: UserData): boolean {
    return this.hasProviderForCurrency(currencyName) && userData.kycLevel >= KycLevel.LEVEL_50;
  }

  /**
   * Deterministic implicit lookup over non-Frick providers, then smallest virtual_iban.id.
   * Bank Frick is exclusively available through the explicit selector path.
   */
  async getActiveForUserAndCurrency(userData: UserData, currencyName: string): Promise<VirtualIban | null> {
    const vibans = await this.virtualIbanRepo.find({
      where: {
        userData: { id: userData.id },
        currency: { name: currencyName },
        bank: { name: Not(IbanBankName.FRICK) },
        buy: IsNull(),
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
      relations: { bank: true },
      order: { id: 'ASC' },
    });

    return this.pickDeterministic(vibans);
  }

  /**
   * Provider-specific active user-level lookup. Filters Bank Frick (or another bank) explicitly,
   * requires buy IS NULL, and picks the smallest id.
   */
  async getActiveForUserCurrencyAndBank(
    userData: UserData,
    currencyName: string,
    bankName: IbanBankName,
  ): Promise<VirtualIban | null> {
    const vibans = await this.virtualIbanRepo.find({
      where: {
        userData: { id: userData.id },
        currency: { name: currencyName },
        bank: { name: bankName },
        buy: IsNull(),
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
      relations: { bank: true },
      order: { id: 'ASC' },
    });

    return vibans[0] ?? null;
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
    if (currencyName !== 'EUR') throw new BadRequestException('Bank Frick personal IBAN is only available for EUR');

    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('KycRequired');

    if (!this.frickVibanProvider.isAvailable())
      throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const bank = await this.bankService.getBankInternal(IbanBankName.FRICK, currencyName);
    if (!bank?.receive) throw new BadRequestException('No bank available for this currency');

    const initial = await this.initializeFrickIntent(userData, bank, currency);
    if (initial.existing) return initial.existing;

    if (initial.intent.status !== VirtualIbanIssuanceIntentStatus.PENDING)
      return this.resolveExistingFrickIntent(initial.intent, userData, bank, currency);

    // Authentication, validation, and signing are completed before the durable claim. A failure here
    // leaves the intent Pending and therefore safely retryable without any possibility of a sent POST.
    await this.frickVibanProvider.prepareVibanReservation(bank.iban, initial.intent.requestReference);

    const claim = await this.claimPendingFrickIntent(initial.intent.id);
    if (!claim.claimed) return this.resolveExistingFrickIntent(claim.intent, userData, bank, currency);

    // No database connection is held across Bank Frick I/O. Once InFlight is durable, no code path
    // issues another POST; retries can only reconcile the exact technical description.
    try {
      const reserved = await this.frickVibanProvider.reserveViban(bank.iban, claim.intent.requestReference);
      return await this.finalizeFrickIssuance(claim.intent.id, userData, bank, currency, reserved);
    } catch (error) {
      let recoveryError: unknown;
      try {
        const recovered = await this.findAndFinalizeFrickIssuance(claim.intent, userData, bank, currency);
        if (recovered) return recovered;
      } catch (caught) {
        recoveryError = caught;
      }

      const createMessage = error instanceof Error ? error.message : 'Bank Frick virtual IBAN create failed';
      const recoveryMessage = recoveryError instanceof Error ? `; recovery failed: ${recoveryError.message}` : '';
      await this.failFrickIntent(claim.intent.id, `${createMessage}${recoveryMessage}`.slice(0, 2000));

      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Bank Frick personal IBAN issuance failed');
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
        [
          `dfx-viban-${Util.randomString(32).toLowerCase()}`,
          userData.id,
          currency.id,
          bank.id,
          VirtualIbanIssuanceIntentStatus.PENDING,
        ],
      );

      let intent = await this.getFrickIntentForUpdate(manager, userData.id, currency.id, bank.id);
      const existing = await this.findActiveForUserCurrencyAndBank(manager, userData.id, currency.id, bank.id);
      if (existing) {
        if (intent.externalIban && intent.externalIban !== existing.iban)
          throw new ServiceUnavailableException('Bank Frick issuance intent conflicts with the active personal IBAN');
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
        intent.error,
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
      return this.finalizeFrickIssuance(intent.id, userData, bank, currency, {
        iban: intent.externalIban,
        providerAccountRef: intent.externalIban,
      });

    if (
      intent.status !== VirtualIbanIssuanceIntentStatus.IN_FLIGHT &&
      intent.status !== VirtualIbanIssuanceIntentStatus.FAILED
    )
      throw new ServiceUnavailableException(
        `Bank Frick virtual IBAN issuance is in unexpected status ${intent.status}`,
      );

    const recovered = await this.findAndFinalizeFrickIssuance(intent, userData, bank, currency);
    if (recovered) return recovered;
    throw new ServiceUnavailableException(
      'Bank Frick virtual IBAN issuance state could not be recovered; refusing a second create',
    );
  }

  private async findAndFinalizeFrickIssuance(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
  ): Promise<VirtualIban | null> {
    const match = await this.frickVibanProvider.findRecoverableByDescription(intent.requestReference, bank.iban);
    if (!match) return null;

    const reserved = await this.frickVibanProvider.adoptAndActivate(match);
    return this.finalizeFrickIssuance(intent.id, userData, bank, currency, reserved);
  }

  private async finalizeFrickIssuance(
    intentId: number,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    reserved: ReservedViban,
  ): Promise<VirtualIban> {
    return this.dataSource.transaction(async (manager) => {
      const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);
      if (intent.externalIban && intent.externalIban !== reserved.iban)
        throw new ServiceUnavailableException('Bank Frick issuance intent conflicts with the recovered personal IBAN');

      const virtualIban = await this.persistUserLevelIfMissing(manager, userData, bank, currency, reserved);
      await this.transitionFrickIntent(manager, intent, VirtualIbanIssuanceIntentStatus.COMPLETED, reserved.iban, null);
      return virtualIban;
    });
  }

  private async failFrickIntent(intentId: number, message: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const intent = await this.getFrickIntentByIdForUpdate(manager, intentId);
      if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED) return;
      await this.transitionFrickIntent(
        manager,
        intent,
        VirtualIbanIssuanceIntentStatus.FAILED,
        intent.externalIban,
        message,
      );
    });
  }

  private async transitionFrickIntent(
    manager: EntityManager,
    intent: VirtualIbanIssuanceIntent,
    nextStatus: VirtualIbanIssuanceIntentStatus,
    nextExternalIban: string | null,
    nextError: string | null,
  ): Promise<VirtualIbanIssuanceIntent> {
    if (intent.status === nextStatus && intent.externalIban === nextExternalIban && intent.error === nextError)
      return intent;

    const event = manager.create(VirtualIbanIssuanceEvent, {
      intentId: intent.id,
      userDataId: intent.userDataId,
      currencyId: intent.currencyId,
      bankId: intent.bankId,
      previousStatus: intent.status,
      nextStatus,
      previousExternalIban: intent.externalIban,
      nextExternalIban,
      previousError: intent.error,
      nextError,
    });
    await manager.save(event);

    intent.status = nextStatus;
    intent.externalIban = nextExternalIban;
    intent.error = nextError;
    return manager.save(intent);
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
    if (!intent) throw new ServiceUnavailableException('Bank Frick virtual IBAN issuance intent could not be created');
    return intent;
  }

  private async getFrickIntentByIdForUpdate(manager: EntityManager, id: number): Promise<VirtualIbanIssuanceIntent> {
    const intent = await manager.findOne(VirtualIbanIssuanceIntent, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!intent) throw new ServiceUnavailableException('Bank Frick virtual IBAN issuance intent not found');
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
      )
        throw new ServiceUnavailableException('Bank Frick virtual IBAN has an incompatible local binding');
      if (!byIban.active || byIban.status !== VirtualIbanStatus.ACTIVE)
        throw new ServiceUnavailableException('Bank Frick virtual IBAN is inactive and requires manual review');
      if (reserved.bban != null && byIban.bban !== reserved.bban)
        throw new ServiceUnavailableException('Bank Frick virtual IBAN BBAN conflicts with the local record');
      if (reserved.providerAccountRef != null && byIban.providerAccountRef !== reserved.providerAccountRef)
        throw new ServiceUnavailableException(
          'Bank Frick virtual IBAN provider reference conflicts with the local record',
        );
      return byIban;
    }

    const existingActive = await this.findActiveForUserCurrencyAndBank(manager, userData.id, currency.id, bank.id);
    if (existingActive)
      throw new ServiceUnavailableException('A different active Bank Frick personal IBAN already exists');

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

    const saved = await manager.save(virtualIban);
    this.virtualIbanRepo.invalidateCache();
    return saved;
  }

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

  private pickDeterministic(vibans: VirtualIban[]): VirtualIban | null {
    const candidates = vibans.filter((viban) => viban.bank.name !== IbanBankName.FRICK);
    if (!candidates.length) return null;

    const providerRank = (name: IbanBankName): number => {
      const idx = this.genericProviders.findIndex((p) => p.bankName === name);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };

    return candidates.sort((a, b) => {
      const rankDiff = providerRank(a.bank.name) - providerRank(b.bank.name);
      return rankDiff !== 0 ? rankDiff : a.id - b.id;
    })[0];
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
