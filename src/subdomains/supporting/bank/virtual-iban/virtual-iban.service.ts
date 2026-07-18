import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { BankService } from '../bank/bank.service';
import { FrickVibanProvider } from './providers/frick-viban.provider';
import { VibanProvider } from './providers/viban-provider.interface';
import { YapealVibanProvider } from './providers/yapeal-viban.provider';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

@Injectable()
export class VirtualIbanService {
  private readonly providers: VibanProvider[];

  constructor(
    private readonly virtualIbanRepo: VirtualIbanRepository,
    private readonly bankService: BankService,
    private readonly fiatService: FiatService,
    private readonly yapealVibanProvider: YapealVibanProvider,
    private readonly frickVibanProvider: FrickVibanProvider,
  ) {
    this.providers = [this.yapealVibanProvider, this.frickVibanProvider];
  }

  isUserEligible(currencyName: string, userData: UserData): boolean {
    return this.hasProviderForCurrency(currencyName) && userData.kycLevel >= KycLevel.LEVEL_50;
  }

  async getActiveForUserAndCurrency(userData: UserData, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneCachedBy(`${userData.id}-${currencyName}`, {
      userData: { id: userData.id },
      currency: { name: currencyName },
      active: true,
      status: VirtualIbanStatus.ACTIVE,
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

  private hasProviderForCurrency(currencyName: string): boolean {
    return this.providers.some((provider) => provider.isAvailable() && provider.currencies.includes(currencyName));
  }

  private getProvider(currencyName: string): VibanProvider {
    const provider = this.providers.find(
      (candidate) => candidate.isAvailable() && candidate.currencies.includes(currencyName),
    );
    if (!provider) throw new BadRequestException('No personal IBAN provider available for this currency');
    return provider;
  }
}
