import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
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
  ) {}

  // TODO: Replace with actual Yapeal API integration
  private generatePlaceholderIban(): string {
    const countryCode = 'CH';
    const checkDigits = Math.floor(10 + Math.random() * 90).toString();
    const bankCode = '89144';
    const accountNumber = Util.createHash(Date.now().toString() + Math.random().toString())
      .substring(0, 12)
      .toUpperCase()
      .replace(/[^0-9]/g, '0');
    return `${countryCode}${checkDigits}${bankCode}${accountNumber}`;
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

  async createForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    const existing = await this.getActiveForUserAndCurrency(userData.id, currencyName);
    if (existing) throw new ConflictException('User already has an active personal IBAN for this currency');

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const bank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, currencyName);
    if (!bank) throw new ConflictException('No bank available for this currency');

    // generate IBAN (placeholder implementation)
    const iban = this.generatePlaceholderIban();

    const virtualIban = this.virtualIbanRepo.create({
      userData,
      bank,
      currency,
      iban,
      status: VirtualIbanStatus.ACTIVE,
      active: true,
      activatedAt: new Date(),
    });

    return this.virtualIbanRepo.save(virtualIban);
  }
}
