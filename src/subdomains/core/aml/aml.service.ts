import { Injectable } from '@nestjs/common';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankData, BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';
import { CheckStatus } from './enums/check-status.enum';

@Injectable()
export class AmlService {
  private readonly logger = new DfxLogger(AmlService);

  constructor(
    private readonly specialExternalBankAccountService: SpecialExternalAccountService,
    private readonly bankDataService: BankDataService,
    private readonly bankService: BankService,
    private readonly nameCheckService: NameCheckService,
    private readonly userDataService: UserDataService,
    private readonly countryService: CountryService,
  ) {}

  async getAmlCheckInput(
    entity: BuyFiat | BuyCrypto,
  ): Promise<{ bankData: BankData; blacklist: SpecialExternalAccount[]; instantBanks?: Bank[] }> {
    const blacklist = await this.specialExternalBankAccountService.getBlacklist();
    const bankData = await this.getBankData(entity);

    if (bankData) {
      if (!entity.userData.hasValidNameCheckDate) await this.checkNameCheck(entity, bankData);

      if (bankData.active) {
        if (
          bankData.userData.id !== entity.userData.id &&
          entity instanceof BuyCrypto &&
          !entity.isCryptoCryptoTransaction &&
          entity.userData.verifiedName &&
          (Util.isSameName(entity.bankTx?.name ?? bankData.userData.verifiedName, entity.userData.verifiedName) ||
            Util.isSameName(entity.bankTx?.ultimateName, entity.userData.verifiedName))
        ) {
          try {
            const [master, slave] =
              bankData.userData.kycLevel < entity.userData.kycLevel
                ? [entity.userData.id, bankData.userData.id]
                : [bankData.userData.id, entity.userData.id];

            await this.userDataService.mergeUserData(master, slave, true);

            entity.userData = await this.userDataService.getUserData(master, { users: true });

            if (!entity.userData.bankTransactionVerification) await this.checkBankTransactionVerification(entity);
          } catch (e) {
            this.logger.error(`Error during userData merge in amlCheck for ${entity.id}:`, e);
          }
        } else if (bankData.userData.id === entity.userData.id && !entity.userData.bankTransactionVerification)
          await this.checkBankTransactionVerification(entity);
      }
    }

    if (entity.userData.isDeactivated)
      entity.userData = await this.userDataService.updateUserDataInternal(
        entity.userData,
        entity.userData.reactivateUserData(),
      );

    if (!entity.userData.verifiedCountry) {
      const verifiedCountry = await this.getVerifiedCountry(entity);
      verifiedCountry && (await this.userDataService.updateUserDataInternal(entity.userData, { verifiedCountry }));
    }

    if (entity instanceof BuyFiat) return { bankData, blacklist };
    if (entity.cryptoInput) return { bankData: undefined, blacklist, instantBanks: undefined };

    const instantBanks = await this.bankService.getInstantBanks();
    return { bankData, blacklist, instantBanks };
  }

  //*** HELPER METHODS ***//

  private async checkBankTransactionVerification(entity: BuyFiat | BuyCrypto): Promise<void> {
    if (entity instanceof BuyCrypto && !entity.bankTx?.iban) return;

    const ibanCountryCheck =
      entity instanceof BuyFiat
        ? entity.sell.iban.startsWith('LI') || entity.sell.iban.startsWith('CH')
        : await this.countryService
            .getCountryWithSymbol(entity.bankTx.iban.substring(0, 2))
            .then((c) => c?.bankTransactionVerificationEnable);

    if (ibanCountryCheck)
      entity.userData = await this.userDataService.updateUserDataInternal(entity.userData, {
        bankTransactionVerification: CheckStatus.GSHEET,
      });
  }

  private async checkNameCheck(entity: BuyFiat | BuyCrypto, bankData: BankData): Promise<void> {
    const hasOpenNameChecks = await this.nameCheckService.hasOpenNameChecks(entity.userData);
    if (hasOpenNameChecks) return;

    await this.nameCheckService.refreshRiskStatus(bankData);

    entity.userData.lastNameCheckDate = bankData.userData.lastNameCheckDate;
  }

  private async getVerifiedCountry(entity: BuyFiat | BuyCrypto): Promise<Country | undefined> {
    if (entity instanceof BuyFiat) return this.countryService.getCountryWithSymbol(entity.sell.iban.substring(0, 2));
    if (entity.cryptoInput) return undefined;

    return this.countryService.getCountryWithSymbol(
      entity.checkoutTx?.cardIssuerCountry ?? entity.bankTx.iban.substring(0, 2),
    );
  }

  private async getBankData(entity: BuyFiat | BuyCrypto): Promise<BankData | undefined> {
    if (entity instanceof BuyFiat) return this.bankDataService.getVerifiedBankDataWithIban(entity.sell.iban);
    if (entity.cryptoInput) {
      const bankDatas = await this.bankDataService.getBankDatasForUser(entity.userData.id);
      return bankDatas?.find((b) => b.type === BankDataType.IDENT) ?? bankDatas?.[0];
    }

    return this.bankDataService.getVerifiedBankDataWithIban(
      entity.bankTx?.senderAccount ?? entity.checkoutTx?.cardFingerPrint,
    );
  }
}
