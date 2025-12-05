import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
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

  async getByIban(iban: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOne({
      where: { iban, active: true },
      relations: { userData: true },
    });
  }

  async createForUser(userData: UserData, currencyName: string): Promise<VirtualIban> {
    const existing = await this.getActiveForUserAndCurrency(userData, currencyName);
    if (existing) throw new ConflictException('User already has an active personal IBAN for this currency');

    const currency = await this.fiatService.getFiatByName(currencyName);
    if (!currency) throw new BadRequestException('Currency not found');

    const bank = await this.bankService.getBankInternal(IbanBankName.YAPEAL, currencyName);
    if (!bank) throw new BadRequestException('No bank available for this currency');

    // Reserve IBAN via YAPEAL API or use placeholder if not configured
    const { iban, bban, accountUid } = await this.reserveVibanFromYapeal();

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

  private async reserveVibanFromYapeal(): Promise<{ iban: string; bban?: string; accountUid?: string }> {
    const { apiKey, partnershipUid } = Config.bank.yapeal;

    // If YAPEAL is not configured, use placeholder IBAN
    if (!apiKey || !partnershipUid) {
      this.logger.warn('YAPEAL not configured, using placeholder IBAN');
      return { iban: this.generatePlaceholderIban() };
    }

    try {
      // First get a VIBAN proposal to get a unique bban
      const proposal = await this.yapealService.getVibanProposal();

      // Then reserve the VIBAN with the proposed bban
      const result = await this.yapealService.reserveViban(proposal.bban);

      return {
        iban: result.iban,
        bban: result.bban,
        accountUid: result.accountUid,
      };
    } catch (e) {
      this.logger.error('Failed to reserve VIBAN from YAPEAL, falling back to placeholder:', e);
      return { iban: this.generatePlaceholderIban() };
    }
  }

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
}
