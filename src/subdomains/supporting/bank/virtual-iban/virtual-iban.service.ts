import { ConflictException, Injectable } from '@nestjs/common';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Bank } from '../bank/bank.entity';
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
  ) {}

  // TODO: Replace with actual Yapeal API integration
  private generatePlaceholderIban(): string {
    const countryCode = 'CH';
    const checkDigits = Math.floor(10 + Math.random() * 90).toString();
    const bankCode = '89144'; // Yapeal bank code
    const accountNumber = Util.createHash(Date.now().toString() + Math.random().toString())
      .substring(0, 12)
      .toUpperCase()
      .replace(/[^0-9]/g, '0');
    return `${countryCode}${checkDigits}${bankCode}${accountNumber}`;
  }

  async getByUserData(userData: UserData): Promise<VirtualIban[]> {
    return this.virtualIbanRepo.findBy({ userData: { id: userData.id }, active: true });
  }

  async getByIban(iban: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneBy({ iban });
  }

  async getById(id: number): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneBy({ id });
  }

  async getActiveForUserAndCurrency(userDataId: number, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneCached(`${userDataId}-${currencyName}`, {
      where: {
        userData: { id: userDataId },
        currency: { name: currencyName },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
    });
  }

  async create(
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    iban: string,
    bban?: string,
    yapealAccountUid?: string,
  ): Promise<VirtualIban> {
    const virtualIban = this.virtualIbanRepo.create({
      userData,
      bank,
      currency,
      iban,
      bban,
      yapealAccountUid,
      status: VirtualIbanStatus.RESERVED,
      active: true,
    });

    return this.virtualIbanRepo.save(virtualIban);
  }

  async activate(virtualIban: VirtualIban): Promise<VirtualIban> {
    virtualIban.status = VirtualIbanStatus.ACTIVE;
    virtualIban.activatedAt = new Date();
    return this.virtualIbanRepo.save(virtualIban);
  }

  async deactivate(virtualIban: VirtualIban): Promise<VirtualIban> {
    virtualIban.status = VirtualIbanStatus.DEACTIVATED;
    virtualIban.deactivatedAt = new Date();
    virtualIban.active = false;
    return this.virtualIbanRepo.save(virtualIban);
  }

  async createForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    // Check if user already has an active vIBAN for this currency
    const existing = await this.getActiveForUserAndCurrency(userData.id, currencyName);
    if (existing) {
      throw new ConflictException('User already has an active personal IBAN for this currency');
    }

    // Get currency entity
    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) {
      throw new ConflictException('Currency not found');
    }

    // Get Yapeal bank for this currency, or fallback to any bank for placeholder implementation
    let bank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, currencyName);
    if (!bank) {
      // TODO: Remove fallback once Yapeal bank is configured in production
      bank = await this.bankService.getBankInternal(IbanBankName.KALEIDO, currencyName);
    }
    if (!bank) {
      throw new ConflictException('No bank available for this currency');
    }

    // Generate placeholder IBAN (will be replaced with actual Yapeal API call)
    const iban = this.generatePlaceholderIban();

    // Create and activate the vIBAN
    const virtualIban = await this.create(userData, bank, currency, iban);
    return this.activate(virtualIban);
  }
}
