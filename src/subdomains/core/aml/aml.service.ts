import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';

@Injectable()
export class AmlService {
  constructor(
    private readonly specialExternalBankAccountService: SpecialExternalAccountService,
    private readonly bankDataService: BankDataService,
    private readonly bankService: BankService,
    private readonly nameCheckService: NameCheckService,
  ) {}

  async getAmlCheckInput(
    entity: BuyFiat | BuyCrypto,
  ): Promise<{ bankData: BankData; blacklist: SpecialExternalAccount[]; instantBanks?: Bank[] }> {
    const blacklist = await this.specialExternalBankAccountService.getBlacklist();
    const bankData = await this.getBankData(entity);

    if (entity instanceof BuyFiat) return { bankData, blacklist };
    if (entity.cryptoInput) return { bankData: undefined, blacklist, instantBanks: undefined };

    const instantBanks = await this.bankService.getInstantBanks();
    return { bankData, blacklist, instantBanks };
  }

  async checkNameCheck(entity: BuyFiat | BuyCrypto): Promise<void> {
    if (
      (entity.userData.lastNameCheckDate &&
        Util.daysDiff(entity.userData.lastNameCheckDate) <= Config.amlCheckLastNameCheckValidity) ||
      this.nameCheckService.hasOpenNameChecks(entity.userData)
    )
      return;

    const bankData = await this.getBankData(entity);
    if (!bankData) return;

    await this.nameCheckService.refreshRiskStatus(bankData);
  }

  //*** HELPER METHODS ***//

  private async getBankData(entity: BuyFiat | BuyCrypto): Promise<BankData | undefined> {
    if (entity instanceof BuyFiat) return this.bankDataService.getBankDataWithIban(entity.sell.iban);
    if (entity.cryptoInput) return undefined;

    const multiAccountIbans = await this.specialExternalBankAccountService.getMultiAccountIbans();
    return this.bankDataService.getBankDataWithIban(
      entity.bankTx
        ? entity.bankTx.senderAccount(multiAccountIbans.map((m) => m.value))
        : entity.checkoutTx.cardFingerPrint,
    );
  }
}
