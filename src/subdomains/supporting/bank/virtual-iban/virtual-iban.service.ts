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

  /**
   * Fail-closed get-or-create of a user-level Frick vIBAN for the explicit personalIbanProvider path.
   * Cross-instance serialized via PostgreSQL advisory lock; crash-recoverable via issuance intent +
   * Frick description matching. Never falls back to another bank/provider.
   */
  async getOrCreateFrickForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    if (currencyName !== 'EUR') throw new BadRequestException('Bank Frick personal IBAN is only available for EUR');

    if (userData.kycLevel < KycLevel.LEVEL_50) throw new BadRequestException('KycRequired');

    if (!this.frickVibanProvider.isAvailable())
      throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const bank = await this.bankService.getBankInternal(IbanBankName.FRICK, currencyName);
    if (!bank?.receive) throw new BadRequestException('No bank available for this currency');

    const lockKey = `viban-issuance:${userData.id}:${currency.id}:${bank.id}`;
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      try {
        const existing = await this.findActiveForUserCurrencyAndBank(
          queryRunner.manager,
          userData.id,
          currency.id,
          bank.id,
        );
        let intent = await queryRunner.manager.findOne(VirtualIbanIssuanceIntent, {
          where: { userDataId: userData.id, currencyId: currency.id, bankId: bank.id },
        });

        // A crash can occur after the local vIBAN commit but before the intent completion update.
        // Reconcile that state while still holding the same session lock.
        if (existing) {
          if (intent && (intent.status !== VirtualIbanIssuanceIntentStatus.COMPLETED || !intent.externalIban)) {
            intent.status = VirtualIbanIssuanceIntentStatus.COMPLETED;
            intent.externalIban = existing.iban;
            intent.error = undefined;
            await queryRunner.manager.save(intent);
          }
          return existing;
        }

        if (!intent) {
          intent = queryRunner.manager.create(VirtualIbanIssuanceIntent, {
            userDataId: userData.id,
            currencyId: currency.id,
            bankId: bank.id,
            // Non-PII technical reference only — never include user identity.
            requestReference: `dfx-viban-${Util.randomString(32).toLowerCase()}`,
            status: VirtualIbanIssuanceIntentStatus.PENDING,
          });
          intent = await queryRunner.manager.save(intent);
        }

        if (intent.status === VirtualIbanIssuanceIntentStatus.COMPLETED && intent.externalIban) {
          return await this.persistUserLevelIfMissing(queryRunner.manager, userData, bank, currency, {
            iban: intent.externalIban,
            providerAccountRef: intent.externalIban,
          });
        }

        // Crash/error recovery: once an intent reached ISSUING (or FAILED), never POST again.
        // Search every recoverable Frick page first and only adopt one exact description match.
        if (
          intent.status === VirtualIbanIssuanceIntentStatus.ISSUING ||
          intent.status === VirtualIbanIssuanceIntentStatus.FAILED
        ) {
          const recovered = await this.recoverFrickIssuance(intent, userData, bank, currency, queryRunner.manager);
          if (recovered) return recovered;
          throw new ServiceUnavailableException(
            'Bank Frick virtual IBAN issuance state could not be recovered; refusing a second create',
          );
        }

        if (intent.status !== VirtualIbanIssuanceIntentStatus.PENDING) {
          throw new ServiceUnavailableException(
            `Bank Frick virtual IBAN issuance is in unexpected status ${intent.status}`,
          );
        }

        // Commit ISSUING before the external POST so a crash mid-call can recover by description.
        intent.status = VirtualIbanIssuanceIntentStatus.ISSUING;
        intent = await queryRunner.manager.save(intent);

        try {
          const reserved = await this.frickVibanProvider.reserveViban(bank.iban, intent.requestReference);
          const virtualIban = await this.persistUserLevelIfMissing(
            queryRunner.manager,
            userData,
            bank,
            currency,
            reserved,
          );
          intent.status = VirtualIbanIssuanceIntentStatus.COMPLETED;
          intent.externalIban = reserved.iban;
          intent.error = undefined;
          await queryRunner.manager.save(intent);
          return virtualIban;
        } catch (error) {
          // Prefer adopting a Frick-side success that we failed to persist locally.
          const recovered = await this.recoverFrickIssuance(intent, userData, bank, currency, queryRunner.manager);
          if (recovered) return recovered;

          const message = error instanceof Error ? error.message : 'Bank Frick virtual IBAN create failed';
          intent.error = message.slice(0, 2000);
          await queryRunner.manager.save(intent);

          if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) throw error;
          throw new ServiceUnavailableException('Bank Frick personal IBAN issuance failed');
        }
      } finally {
        await queryRunner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      }
    } finally {
      await queryRunner.release();
    }
  }

  private async recoverFrickIssuance(
    intent: VirtualIbanIssuanceIntent,
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    manager: EntityManager,
  ): Promise<VirtualIban | null> {
    const match = await this.frickVibanProvider.findRecoverableByDescription(intent.requestReference, bank.iban);
    if (!match) return null;

    const reserved = await this.frickVibanProvider.adoptAndActivate(match);
    const virtualIban = await this.persistUserLevelIfMissing(manager, userData, bank, currency, reserved);

    intent.status = VirtualIbanIssuanceIntentStatus.COMPLETED;
    intent.externalIban = reserved.iban;
    intent.error = undefined;
    await manager.save(intent);

    return virtualIban;
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

      byIban.bban = reserved.bban;
      byIban.providerAccountRef = reserved.providerAccountRef;
      byIban.status = VirtualIbanStatus.ACTIVE;
      byIban.active = true;
      byIban.activatedAt ??= new Date();
      byIban.deactivatedAt = undefined;
      const saved = await manager.save(byIban);
      this.virtualIbanRepo.invalidateCache();
      return saved;
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
