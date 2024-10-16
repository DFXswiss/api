import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IbanDetailsDto, IbanService } from 'src/integration/bank/services/iban.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { IEntity } from 'src/shared/models/entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { KycType, UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { IsNull } from 'typeorm';
import { BankAccount, BankAccountInfos } from './bank-account.entity';
import { BankAccountRepository } from './bank-account.repository';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Injectable()
export class BankAccountService {
  private readonly logger = new DfxLogger(BankAccountService);

  constructor(
    private readonly bankAccountRepo: BankAccountRepository,
    private readonly userDataService: UserDataService,
    private readonly ibanService: IbanService,
    private readonly fiatService: FiatService,
    private readonly countryService: CountryService,
    private readonly bankDataService: BankDataService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async process() {
    if (DisabledProcess(Process.BANK_DATA_SYNC)) return;

    const entities = await this.bankAccountRepo.find({
      where: { synced: IsNull() },
      relations: { userData: true },
      take: 5000,
    });

    for (const entity of entities) {
      try {
        if (entity.userData) {
          if (entity.userData.status === UserDataStatus.MERGED) {
            await this.bankAccountRepo.update(entity.id, { synced: false });
            continue;
          }

          await this.bankDataService.createIbanForUser(
            entity.userData?.id,
            entity.iban,
            false,
            entity.label,
            entity.preferredCurrency,
            BankDataType.USER,
          );
        }

        await this.bankAccountRepo.update(entity.id, { synced: true });
      } catch (e) {
        this.logger.error(`Error in bankAccount-bankData sync ${entity.id}:`, e);
      }
    }
  }

  async getUserBankAccounts(userDataId: number): Promise<BankAccount[]> {
    return this.bankAccountRepo.findBy({ userData: { id: userDataId } });
  }

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

  async createBankAccount(userDataId: number, dto: CreateBankAccountDto): Promise<BankAccount> {
    const userData = await this.userDataService.getUserData(userDataId);

    const bankAccount = await this.getOrCreateBankAccountInternal(dto.iban, userData);

    return this.updateEntity(dto, bankAccount);
  }

  async updateBankAccount(id: number, userDataId: number, dto: UpdateBankAccountDto): Promise<BankAccount> {
    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id, userData: { id: userDataId } },
      relations: ['userData'],
    });
    if (!bankAccount) throw new NotFoundException('BankAccount not found');

    return this.updateEntity(dto, bankAccount);
  }

  // --- INTERNAL METHODS --- //

  @Cron(CronExpression.EVERY_WEEK)
  @Lock(3600)
  async checkFailedBankAccounts(): Promise<void> {
    if (DisabledProcess(Process.BANK_ACCOUNT)) return;

    const failedBankAccounts = await this.bankAccountRepo.findBy({ returnCode: 256 });
    for (const bankAccount of failedBankAccounts) {
      await this.reloadBankAccount(bankAccount);
    }
  }

  async getOrCreateBankAccount(iban: string, userId: number): Promise<BankAccount> {
    const userData = await this.userDataService.getUserDataByUser(userId);
    return this.getOrCreateBankAccountInternal(iban, userData);
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

    return this.bankAccountRepo.save(bankAccount);
  }

  async getOrCreateBankAccountInternal(iban: string, userData?: UserData): Promise<BankAccount> {
    const bankAccounts = await this.bankAccountRepo.find({
      where: { iban },
      relations: { userData: true },
    });

    if (userData)
      return (
        bankAccounts.find((b) => b.userData?.id === userData.id) ??
        (await this.createBankAccountInternal(iban, userData, bankAccounts[0]))
      );

    return bankAccounts.length ? bankAccounts[0] : this.createBankAccountInternal(iban);
  }

  private async createBankAccountInternal(
    iban: string,
    userData?: UserData,
    copyFrom?: BankAccount,
  ): Promise<BankAccount> {
    if (!(await this.isValidIbanCountry(iban, userData?.kycType)))
      throw new BadRequestException('Iban country is currently not supported');

    const bankAccount = copyFrom ? IEntity.copy(copyFrom) : await this.initBankAccount(iban);
    if (userData) bankAccount.userData = userData;

    return this.bankAccountRepo.save(bankAccount);
  }

  private async isValidIbanCountry(iban: string, kycType = KycType.DFX): Promise<boolean> {
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
