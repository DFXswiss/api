import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
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
    return this.virtualIbanRepo.findOneCached(`${userData.id}-${currencyName}`, {
      where: {
        userData: { id: userData.id },
        currency: { name: currencyName },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
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

    return this.virtualIbanRepo.save(virtualIban);
  }

  async getVirtualIbansForAccount(userData: UserData): Promise<VirtualIban[]> {
    return this.virtualIbanRepo.findCachedBy(`user-${userData.id}`, { userData: { id: userData.id } });
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

  async getAllActiveVirtualIbans(): Promise<string[]> {
    const virtualIbans = await this.virtualIbanRepo.find({
      where: { active: true, status: VirtualIbanStatus.ACTIVE },
      select: { iban: true },
    });
    return virtualIbans.map((v) => v.iban);
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
}
