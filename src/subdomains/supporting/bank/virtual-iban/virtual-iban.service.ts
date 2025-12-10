import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as IbanTools from 'ibantools';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { BankService } from '../bank/bank.service';
import { IbanBankName } from '../bank/dto/bank.dto';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

@Injectable()
export class VirtualIbanService {
  private readonly logger = new DfxLogger(VirtualIbanService);

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

  private async reserveVibanFromYapeal(
    accountIban: string,
  ): Promise<{ iban: string; bban?: string; accountUid?: string }> {
    if (!this.yapealService.isAvailable()) {
      this.logger.info('YAPEAL not configured, using placeholder IBAN');
      return this.generatePlaceholderIban();
    }

    const result = await this.yapealService.createViban(accountIban);

    return {
      iban: result.iban,
      bban: result.bban,
      accountUid: result.accountUid,
    };
  }

  private generatePlaceholderIban(): { iban: string; bban: string } {
    const bankCode = '89144';
    const accountNumber = Util.createHash(Date.now().toString() + Math.random().toString())
      .substring(0, 12)
      .toUpperCase()
      .replace(/[^0-9]/g, '0');

    const bban = bankCode + accountNumber;

    return { bban, iban: IbanTools.composeIBAN({ countryCode: 'CH', bban }) };
  }
}
