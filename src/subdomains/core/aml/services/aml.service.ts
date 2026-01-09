import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { BankData, BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { SpecialExternalAccount } from 'src/subdomains/supporting/payment/entities/special-external-account.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { AmlReason } from '../enums/aml-reason.enum';
import { CheckStatus } from '../enums/check-status.enum';

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
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    private readonly userService: UserService,
    private readonly transactionService: TransactionService,
    private readonly ipLogService: IpLogService,
  ) {}

  async postProcessing(
    entity: BuyFiat | BuyCrypto,
    amlCheckBefore: CheckStatus,
    last30dVolume: number | undefined,
  ): Promise<void> {
    if (entity.cryptoInput) await this.payInService.updatePayInAction(entity.cryptoInput.id, entity.amlCheck);

    if (amlCheckBefore !== entity.amlCheck && entity.amlReason === AmlReason.VIDEO_IDENT_NEEDED)
      await this.userDataService.triggerVideoIdent(entity.userData);

    if (entity.amlCheck === CheckStatus.PASS) {
      if (entity.user.status === UserStatus.NA) await this.userService.activateUser(entity.user, entity.userData);
      if (entity.bankTx && entity instanceof BuyCrypto && !entity.userData.hasBankTx)
        await this.userDataService.updateUserDataInternal(entity.userData, { hasBankTx: true });
      if (
        !entity.userData.bankTransactionVerification &&
        entity instanceof BuyFiat &&
        Config.isDomesticIban(entity.sell.iban)
      )
        entity.userData = await this.userDataService.updateUserDataInternal(entity.userData, {
          bankTransactionVerification: CheckStatus.GSHEET,
        });

      await this.transactionService.updateInternal(entity.transaction, {
        amlCheck: entity.amlCheck,
        assets: `${entity.inputReferenceAsset}-${entity.outputAsset.name}`,
        amountInChf: entity.amountInChf,
        highRisk: entity.highRisk == true,
        eventDate: entity.created,
        amlType: entity.transaction.type,
      });

      // KYC file id
      if (
        !entity.userData.kycFileId &&
        (!entity.cryptoInput || entity.cryptoInput.txType !== PayInType.PAYMENT) &&
        last30dVolume > Config.tradingLimits.monthlyDefaultWoKyc
      ) {
        const kycFileId = (await this.userDataService.getLastKycFileId()) + 1;
        await this.userDataService.updateUserDataInternal(entity.userData, { kycFileId, amlListAddedDate: new Date() });
      }
    }
  }

  async getAmlCheckInput(entity: BuyFiat | BuyCrypto): Promise<{
    users: User[];
    refUser: User;
    bankData: BankData;
    blacklist: SpecialExternalAccount[];
    banks?: Bank[];
    ipLogCountries?: string[];
    multiAccountBankNames?: string[];
  }> {
    const blacklist = await this.specialExternalBankAccountService.getBlacklist();
    const multiAccountBankNames = await this.specialExternalBankAccountService.getMultiAccountNames();

    entity.userData.users = await this.userService.getAllUserDataUsers(entity.userData.id);
    let bankData = await this.getBankData(entity);
    const refUser =
      entity.user.usedRef !== Config.defaultRef ? await this.userService.getRefUser(entity.user.usedRef) : undefined;

    if (bankData) {
      if (!entity.userData.hasValidNameCheckDate) {
        try {
          await this.checkNameCheck(entity, bankData);
        } catch (e) {
          this.logger.error(`Error during aml nameCheck for ${entity.id}`, e);
        }
      }

      // merge & bank transaction verification
      if (bankData.approved) {
        if (
          bankData.userData.id !== entity.userData.id &&
          entity instanceof BuyCrypto &&
          !entity.isCryptoCryptoTransaction &&
          (Util.isSameName(bankData.userData.verifiedName, entity.userData.verifiedName) ||
            Util.isSameName(
              entity.bankTx?.name ?? entity.checkoutTx?.cardName,
              entity.userData.verifiedName ?? bankData.name,
            ) ||
            Util.isSameName(entity.bankTx?.ultimateName, entity.userData.verifiedName ?? bankData.name)) &&
          (!entity.bankTx || !multiAccountBankNames.includes(entity.bankTx.name) || entity.bankTx.ultimateName) &&
          !multiAccountBankNames.includes(bankData.name)
        ) {
          try {
            const [master, slave] = AccountMergeService.masterFirst([entity.userData, bankData.userData]);

            await this.userDataService.mergeUserData(master.id, slave.id, entity.userData.mail, true);

            entity.userData = await this.userDataService.getUserData(master.id, { users: true });
            if (master.id !== bankData.userData.id) bankData = await this.getBankData(entity);

            if (!entity.userData.bankTransactionVerification) await this.checkBankTransactionVerification(entity);
          } catch (e) {
            this.logger.error(`Error during userData merge in amlCheck for ${entity.id}:`, e);
          }
        } else if (bankData.userData.id === entity.userData.id && !entity.userData.bankTransactionVerification)
          await this.checkBankTransactionVerification(entity);
      }
    } else if (!entity.userData.hasValidNameCheckDate && entity instanceof BuyCrypto && entity.cryptoRoute) {
      try {
        const identBankData = await this.bankDataService.getIdentBankDataForUser(entity.userData.id);
        if (identBankData) await this.checkNameCheck(entity, identBankData);
      } catch (e) {
        this.logger.error(`Error during aml ident nameCheck for ${entity.id}`, e);
      }
    }

    if (entity.userData.isDeactivated)
      entity.userData = await this.userDataService.updateUserDataInternal(
        entity.userData,
        entity.userData.reactivateUserData(),
      );

    // verified country
    if (!entity.userData.verifiedCountry) {
      const verifiedCountry = await this.getVerifiedCountry(entity);
      if (verifiedCountry) await this.userDataService.updateUserDataInternal(entity.userData, { verifiedCountry });
    }

    if (entity instanceof BuyFiat) return { users: entity.userData.users, refUser, bankData, blacklist };

    const ipLogCountries = await this.ipLogService.getLoginCountries(entity.userData.id, Util.daysBefore(3));

    if (entity.cryptoInput)
      return {
        users: entity.userData.users,
        refUser,
        bankData: undefined,
        blacklist,
        banks: undefined,
        ipLogCountries,
      };

    const banks = await this.bankService.getAllBanks();
    return { users: entity.userData.users, refUser, bankData, blacklist, banks, ipLogCountries, multiAccountBankNames };
  }

  //*** HELPER METHODS ***//

  private async checkBankTransactionVerification(entity: BuyFiat | BuyCrypto): Promise<void> {
    if ((entity instanceof BuyCrypto && !entity.bankTx?.iban && !entity.bankTx?.bic) || entity instanceof BuyFiat)
      return;

    const ibanCountryCheck =
      entity.bankTx?.iban &&
      (await this.countryService
        .getCountryWithSymbol(entity.bankTx.iban.substring(0, 2))
        .then((c) => c?.bankTransactionVerificationEnable));

    const bicCountryCheck =
      !ibanCountryCheck &&
      entity.bankTx?.bic &&
      (await this.countryService
        .getCountryWithSymbol(entity.bankTx.bic.substring(4, 6))
        .then((c) => c?.bankTransactionVerificationEnable));

    if (ibanCountryCheck || bicCountryCheck)
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
    if (entity instanceof BuyFiat)
      return this.bankDataService.getVerifiedBankDataWithIban(entity.sell.iban, undefined, undefined, {
        userData: true,
      });
    if (entity.cryptoInput) {
      const bankDatas = await this.bankDataService
        .getValidBankDatasForUser(entity.userData.id)
        .then((b) => b.filter((b) => ![BankDataType.USER, BankDataType.NAME_CHECK].includes(b.type)));
      return bankDatas?.find((b) => b.type === BankDataType.IDENT) ?? bankDatas?.[0];
    }

    return this.bankDataService.getVerifiedBankDataWithIban(
      entity.bankTx?.senderAccount ?? entity.checkoutTx?.cardFingerPrint,
      undefined,
      undefined,
      { userData: true },
    );
  }
}
