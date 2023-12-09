import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IbanDetailsDto, IbanService } from 'src/integration/bank/services/iban.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { IEntity } from 'src/shared/models/entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Process, ProcessService } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { KycType, UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { BankAccount, BankAccountInfos } from './bank-account.entity';
import { BankAccountRepository } from './bank-account.repository';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Injectable()
export class BankAccountService {
  constructor(
    private readonly bankAccountRepo: BankAccountRepository,
    private readonly userDataService: UserDataService,
    private readonly ibanService: IbanService,
    private readonly fiatService: FiatService,
    private readonly countryService: CountryService,
    private readonly processService: ProcessService,
  ) {}

  async getUserBankAccounts(userId: number): Promise<BankAccount[]> {
    return this.bankAccountRepo
      .createQueryBuilder('bankAccount')
      .innerJoin('bankAccount.userData', 'userData')
      .innerJoin('userData.users', 'user')
      .leftJoinAndSelect('bankAccount.preferredCurrency', 'preferredCurrency')
      .where('user.id = :id', { id: userId })
      .getMany();
  }

  async getBankAccountByKey(key: string, value: any): Promise<BankAccount> {
    return this.bankAccountRepo
      .createQueryBuilder('bankAccount')
      .select('bankAccount')
      .leftJoinAndSelect('bankAccount.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `bankAccount.${key}`} = :param`, { param: value })
      .getOne();
  }

  async createBankAccount(userId: number, dto: CreateBankAccountDto): Promise<BankAccount> {
    const { id: userDataId, kycType: kycType } = await this.userDataService.getUserDataByUser(userId);

    const existing = await this.bankAccountRepo.findOne({
      where: { iban: dto.iban, userData: { id: userDataId } },
      relations: ['userData'],
    });
    if (existing) {
      if (existing.active) throw new ConflictException('BankAccount already exists');

      if (!existing.active) {
        // reactivate deleted bank account
        existing.active = true;
        await this.bankAccountRepo.save(existing);
      }

      return existing;
    }

    const bankAccount = await this.getOrCreateBankAccountInternal(dto.iban, userDataId, kycType);

    const update = await this.updateEntity(dto, bankAccount);
    return this.bankAccountRepo.save(update);
  }

  async updateBankAccount(id: number, userId: number, dto: UpdateBankAccountDto): Promise<BankAccount> {
    const { id: userDataId } = await this.userDataService.getUserDataByUser(userId);

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id, userData: { id: userDataId } },
      relations: ['userData'],
    });
    if (!bankAccount) throw new NotFoundException('BankAccount not found');

    const update = await this.updateEntity(dto, bankAccount);
    return this.bankAccountRepo.save(update);
  }

  // --- INTERNAL METHODS --- //

  @Cron(CronExpression.EVERY_WEEK)
  @Lock(3600)
  async checkFailedBankAccounts(): Promise<void> {
    if (await this.processService.isDisableProcess(Process.BANK_ACCOUNT)) return;

    const failedBankAccounts = await this.bankAccountRepo.findBy({ returnCode: 256 });
    for (const bankAccount of failedBankAccounts) {
      await this.reloadBankAccount(bankAccount);
    }
  }

  async getOrCreateBankAccount(iban: string, userId: number): Promise<BankAccount> {
    const { id: userDataId, kycType: kycType } = await this.userDataService.getUserDataByUser(userId);
    return this.getOrCreateBankAccountInternal(iban, userDataId, kycType);
  }

  // --- HELPER METHODS --- //
  private async updateEntity(
    dto: CreateBankAccountDto | UpdateBankAccountDto,
    bankAccount: BankAccount,
  ): Promise<BankAccount> {
    Object.assign(bankAccount, dto);

    // check currency
    if (dto.preferredCurrency) {
      bankAccount.preferredCurrency = await this.fiatService.getFiat(dto.preferredCurrency.id);
      if (!bankAccount.preferredCurrency) throw new BadRequestException('Currency not found');
    }

    return bankAccount;
  }

  async getOrCreateBankAccountInternal(iban: string, userDataId: number, kycType: KycType): Promise<BankAccount> {
    const bankAccounts = await this.bankAccountRepo.find({
      where: { iban },
      relations: ['userData'],
    });

    return (
      bankAccounts.find((b) => b.userData.id === userDataId) ??
      (await this.createBankAccountInternal(iban, userDataId, kycType, bankAccounts[0]))
    );
  }

  private async createBankAccountInternal(
    iban: string,
    userDataId: number,
    kycType: KycType,
    copyFrom?: BankAccount,
  ): Promise<BankAccount> {
    if (!(await this.isValidIbanCountry(iban, kycType)))
      throw new BadRequestException('Iban country is currently not supported');

    const bankAccount = copyFrom ? IEntity.copy(copyFrom) : await this.initBankAccount(iban);
    bankAccount.userData = { id: userDataId } as UserData;

    return this.bankAccountRepo.save(bankAccount);
  }

  private async isValidIbanCountry(iban: string, kycType: KycType): Promise<boolean> {
    const ibanCountry = await this.countryService.getCountryWithSymbol(iban.substring(0, 2));

    return ibanCountry.isEnabled(kycType);
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
