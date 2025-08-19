import { BadRequestException, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { BankDetailsDto, IbanDetailsDto, IbanService } from 'src/integration/bank/services/iban.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { IsNull } from 'typeorm';
import { BankAccount, BankAccountInfos } from './bank-account.entity';
import { BankAccountRepository } from './bank-account.repository';

@Injectable()
export class BankAccountService {
  constructor(
    private readonly bankAccountRepo: BankAccountRepository,
    private readonly ibanService: IbanService,
    private readonly countryService: CountryService,
  ) {}

  async getBankAccountByKey(key: string, value: any): Promise<BankAccount> {
    return this.bankAccountRepo
      .createQueryBuilder('bankAccount')
      .select('bankAccount')
      .leftJoinAndSelect('bankAccount.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `bankAccount.${key}`} = :param`, { param: value })
      .getOne();
  }

  // --- INTERNAL METHODS --- //

  @DfxCron(CronExpression.EVERY_WEEK, { process: Process.BANK_ACCOUNT, timeout: 3600 })
  async checkFailedBankAccounts(): Promise<void> {
    const failedBankAccounts = await this.bankAccountRepo.findBy({ returnCode: 256 });
    for (const bankAccount of failedBankAccounts) {
      await this.reloadBankAccount(bankAccount);
    }
  }

  @DfxCron(CronExpression.EVERY_10_MINUTES, { process: Process.BANK_ACCOUNT, timeout: 3600 })
  async reloadUncheckedBankAccounts(): Promise<void> {
    const bankAccounts = await this.bankAccountRepo.findBy({ result: IsNull() });
    for (const bankAccount of bankAccounts) {
      await this.reloadBankAccount(bankAccount);
    }
  }

  // --- HELPER METHODS --- //

  async getOrCreateIbanBankAccountInternal(iban: string, validateIbanCountry = true): Promise<BankAccount> {
    return (
      (await this.bankAccountRepo.findOneBy({ iban })) ??
      this.createBankAccountInternal(iban, undefined, validateIbanCountry)
    );
  }

  async getOrCreateBicBankAccountInternal(bic: string): Promise<BankAccount> {
    return (await this.bankAccountRepo.findOneBy({ bic })) ?? this.createBankAccountInternal(undefined, bic, false);
  }

  private async createBankAccountInternal(
    iban: string,
    bic: string,
    validateIbanCountry: boolean,
  ): Promise<BankAccount> {
    if (validateIbanCountry && !(await this.isValidIbanCountry(iban)))
      throw new BadRequestException('Iban country is currently not supported');

    const bankAccount = iban ? await this.initIbanBankAccount(iban) : await this.initBicBankAccount(bic);

    return this.bankAccountRepo.save(bankAccount);
  }

  private async isValidIbanCountry(iban: string, kycType = KycType.DFX): Promise<boolean> {
    const ibanCountry = await this.countryService.getCountryWithSymbol(iban.substring(0, 2));

    return ibanCountry?.isEnabled(kycType);
  }

  private async initIbanBankAccount(iban: string): Promise<BankAccount> {
    const bankDetails = await this.ibanService.getIbanInfos(iban);
    return this.bankAccountRepo.create({ ...this.parseIbanBankDetails(bankDetails), iban });
  }

  private async initBicBankAccount(bic: string): Promise<BankAccount> {
    const bankDetails = await this.ibanService.getBankInfos(bic);
    return this.bankAccountRepo.create({ ...this.parseBankDetails(bankDetails), bic });
  }

  private async reloadBankAccount(bankAccount: BankAccount): Promise<void> {
    const bankDetails = await this.ibanService.getIbanInfos(bankAccount.iban);
    await this.bankAccountRepo.save({ ...bankAccount, ...this.parseIbanBankDetails(bankDetails) });
  }

  private parseIbanBankDetails(ibanDetails: IbanDetailsDto): BankAccountInfos {
    return {
      result: this.parseString(ibanDetails.result),
      returnCode: !ibanDetails.return_code ? null : ibanDetails.return_code,
      checks: ibanDetails.checks.length > 0 ? ibanDetails.checks.join(',') : null,
      bic: ibanDetails.bic_candidates.length > 0 ? ibanDetails.bic_candidates.map((c) => c.bic).join(',') : null,
      bankName: this.parseString(ibanDetails.bank),
      allBicCandidates:
        ibanDetails.all_bic_candidates.length > 0 ? ibanDetails.all_bic_candidates.map((c) => c.bic).join(',') : null,
      bankCode: this.parseString(ibanDetails.bank_code),
      bankAndBranchCode: this.parseString(ibanDetails.bank_and_branch_code),
      bankAddress: this.parseAddressString(
        ibanDetails.bank_address,
        ibanDetails.bank_street,
        ibanDetails.bank_city,
        ibanDetails.bank_state,
        ibanDetails.bank_postal_code,
      ),
      bankUrl: this.parseString(ibanDetails.bank_url),
      branch: this.parseString(ibanDetails.branch),
      branchCode: this.parseString(ibanDetails.branch_code),
      sct: this.parseBoolean(ibanDetails.sct),
      sdd: this.parseBoolean(ibanDetails.sdd),
      b2b: this.parseBoolean(ibanDetails.b2b),
      scc: this.parseBoolean(ibanDetails.scc),
      sctInst: this.parseBoolean(ibanDetails.sct_inst),
      sctInstReadinessDate: !ibanDetails.sct_inst_readiness_date ? null : new Date(ibanDetails.sct_inst_readiness_date),
      accountNumber: this.parseString(ibanDetails.account_number),
      dataAge: this.parseString(ibanDetails.data_age),
      ibanListed: this.parseString(ibanDetails.iban_listed),
      ibanWwwOccurrences: !ibanDetails.iban_www_occurrences ? null : ibanDetails.iban_www_occurrences,
    };
  }

  private parseBankDetails(bankDetails: BankDetailsDto): BankAccountInfos {
    return {
      result: this.parseString(bankDetails.result),
      bankName: this.parseString(bankDetails.banks[0].name),
      bankCode: bankDetails.banks[0].code,
      bankAddress: bankDetails.banks[0].address,
      sct: this.parseBoolean(bankDetails.banks[0].sct),
      sdd: this.parseBoolean(bankDetails.banks[0].sdd),
      b2b: this.parseBoolean(bankDetails.banks[0].b2b),
    };
  }

  private parseString(temp: string): string {
    return !temp ? null : temp;
  }

  private parseAddressString(address: string, street: string, city: string, state: string, postalCode: string): string {
    return !address && !street && !city && !state && !postalCode
      ? null
      : address + ',' + street + ',' + city + ',' + state + ',' + postalCode;
  }

  private parseBoolean(temp: string): boolean {
    return !temp ? null : temp === 'yes' ? true : false;
  }
}
