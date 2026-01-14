import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { BankService } from '../bank/bank.service';
import { IbanBankName } from '../bank/dto/bank.dto';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

@Injectable()
export class VirtualIbanService {
  constructor(
    private readonly virtualIbanRepo: VirtualIbanRepository,
    private readonly bankService: BankService,
    private readonly fiatService: FiatService,
    private readonly yapealService: YapealService,
  ) {}

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

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const bank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, currencyName);
    if (!bank) throw new BadRequestException('No bank available for this currency');

    const { iban, bban, accountUid } = await this.reserveVibanFromYapeal(bank.iban);

    const virtualIban = this.virtualIbanRepo.create({
      userData,
      bank,
      currency,
      iban,
      bban,
      yapealAccountUid: accountUid,
      status: VirtualIbanStatus.ACTIVE,
      active: true,
      activatedAt: new Date(),
    });

    const saved = await this.virtualIbanRepo.save(virtualIban);

    this.virtualIbanRepo.invalidateCache();

    return saved;
  }

  async createForBuy(userData: UserData, buy: Buy, currencyName: string): Promise<VirtualIban> {
    const existingForBuy = await this.getActiveForBuyAndCurrency(buy.id, currencyName);
    if (existingForBuy) throw new ConflictException('Buy already has an active personal IBAN for this currency');

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const bank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, currencyName);
    if (!bank) throw new BadRequestException('No bank available for this currency');

    const { iban, bban, accountUid } = await this.reserveVibanFromYapeal(bank.iban);

    const virtualIban = this.virtualIbanRepo.create({
      userData,
      bank,
      currency,
      iban,
      bban,
      yapealAccountUid: accountUid,
      status: VirtualIbanStatus.ACTIVE,
      active: true,
      activatedAt: new Date(),
      buy,
      label: buy.asset?.name,
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

  async getByIbanWithBuy(iban: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOne({
      where: { iban },
      relations: { userData: true, bank: true, buy: { user: { userData: true } } },
    });
  }

  async countActiveForUser(userDataId: number): Promise<number> {
    return this.virtualIbanRepo.countBy({
      userData: { id: userDataId },
      active: true,
      status: VirtualIbanStatus.ACTIVE,
    });
  }

  async getByIban(iban: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneCached(iban, {
      where: { iban },
      relations: { userData: true, bank: true },
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

  private async reserveVibanFromYapeal(
    accountIban: string,
  ): Promise<{ iban: string; bban?: string; accountUid?: string }> {
    if (!this.yapealService.isAvailable()) {
      throw new ServiceUnavailableException('Yapeal service is not available');
    }

    const result = await this.yapealService.createViban(accountIban);

    return {
      iban: result.iban,
      bban: result.bban,
      accountUid: result.accountUid,
    };
  }

  async getVirtualIbanForAccount(userDataId: number): Promise<VirtualIban[]> {
    return this.virtualIbanRepo.findCachedBy(userDataId, { userData: { id: userDataId } });
  }
}
