import { BadRequestException, Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { IbanDetailsDto, IbanService } from 'src/integration/bank/services/iban.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { IEntity } from 'src/shared/models/entity';
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

  async getOrCreateBankAccountInternal(iban: string): Promise<BankAccount> {
    return (await this.bankAccountRepo.findOneBy({ iban })) ?? this.createBankAccountInternal(iban);
  }

  private async createBankAccountInternal(iban: string, copyFrom?: BankAccount): Promise<BankAccount> {
    if (!(await this.isValidIbanCountry(iban)))
      throw new BadRequestException('Iban country is currently not supported');

    const bankAccount = copyFrom ? IEntity.copy(copyFrom) : await this.initBankAccount(iban);

    return this.bankAccountRepo.save(bankAccount);
  }

  private async isValidIbanCountry(iban: string, kycType = KycType.DFX): Promise<boolean> {
    const ibanCountry = await this.countryService.getCountryWithSymbol(iban.substring(0, 2));

    return ibanCountry?.isEnabled(kycType);
  }

  private async initBankAccount(iban: string): Promise<BankAccount> {
    const bankDetails = await this.ibanService.getIbanInfos(iban);
    return this.bankAccountRepo.create({ ...this.parseBankDetails(bankDetails), iban });
  }

  private async reloadBankAccount(bankAccount: BankAccount): Promise<void> {
    const bankDetails = await this.ibanService.getIbanInfos(bankAccount.iban);
    await this.bankAccountRepo.save({ ...bankAccount, ...this.parseBankDetails(bankDetails) });
  }

  private parseBankDetails(bankDetails: IbanDetailsDto): BankAccountInfos {
    return {
      result: this.parseString(bankDetails.result),
      returnCode: !bankDetails.return_code ? null : bankDetails.return_code,
      checks: bankDetails.checks.length > 0 ? bankDetails.checks.join(',') : null,
      bic: bankDetails.bic_candidates.length > 0 ? bankDetails.bic_candidates.map((c) => c.bic).join(',') : null,
      bankName: this.parseString(bankDetails.bank),
      allBicCandidates:
        bankDetails.all_bic_candidates.length > 0 ? bankDetails.all_bic_candidates.map((c) => c.bic).join(',') : null,
      bankCode: this.parseString(bankDetails.bank_code),
      bankAndBranchCode: this.parseString(bankDetails.bank_and_branch_code),
      bankAddress: this.parseAddressString(
        bankDetails.bank_address,
        bankDetails.bank_street,
        bankDetails.bank_city,
        bankDetails.bank_state,
        bankDetails.bank_postal_code,
      ),
      bankUrl: this.parseString(bankDetails.bank_url),
      branch: this.parseString(bankDetails.branch),
      branchCode: this.parseString(bankDetails.branch_code),
      sct: this.parseBoolean(bankDetails.sct),
      sdd: this.parseBoolean(bankDetails.sdd),
      b2b: this.parseBoolean(bankDetails.b2b),
      scc: this.parseBoolean(bankDetails.scc),
      sctInst: this.parseBoolean(bankDetails.sct_inst),
      sctInstReadinessDate: !bankDetails.sct_inst_readiness_date ? null : new Date(bankDetails.sct_inst_readiness_date),
      accountNumber: this.parseString(bankDetails.account_number),
      dataAge: this.parseString(bankDetails.data_age),
      ibanListed: this.parseString(bankDetails.iban_listed),
      ibanWwwOccurrences: !bankDetails.iban_www_occurrences ? null : bankDetails.iban_www_occurrences,
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
