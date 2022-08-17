import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IbanService } from 'src/shared/services/iban.service';
import { User } from 'src/user/models/user/user.entity';
import { BankAccountRepository } from './bank-account.repository';
import { IbanDetailsDto } from 'src/shared/services/iban.service';
import { BankAccount, BankAccountInfos } from './bank-account.entity';
import { IEntity } from 'src/shared/models/entity';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/util';

@Injectable()
export class BankAccountService {
  constructor(private readonly bankAccountRepo: BankAccountRepository, private readonly ibanService: IbanService) {}

  async getBankAccount(iban: string, userId: number): Promise<BankAccount> {
    const bankAccounts = await this.bankAccountRepo.find({
      where: { iban },
      relations: ['user'],
    });

    return (
      bankAccounts.find((b) => b.user.id === userId) ??
      (await this.createBankAccountInternal(iban, userId, bankAccounts[0]))
    );
  }

  //

  async getUserBankAccounts(userId: number): Promise<BankAccount[]> {
    return this.bankAccountRepo.find({ user: { id: userId } });
  }

  async createBankAccount(userId: number, createBankAccountDto: CreateBankAccountDto): Promise<BankAccount> {
    const bankAccounts = await this.bankAccountRepo.find({
      where: { iban: createBankAccountDto.iban, user: { id: userId } },
      relations: ['user'],
    });
    if (bankAccounts) throw new ForbiddenException('bankAccount already exists');

    const bankAccount = await this.initBankAccount(createBankAccountDto.iban);
    bankAccount.user = { id: userId } as User;
    bankAccount.preferredCurrency = { id: createBankAccountDto.preferredCurrency.id } as Fiat;
    if (createBankAccountDto.label) bankAccount.label = createBankAccountDto.label;

    return this.bankAccountRepo.save(bankAccount);
  }

  async updateBankAccount(userId: number, dto: UpdateBankAccountDto): Promise<BankAccount> {
    let entity = await this.bankAccountRepo.findOne({
      where: { iban: dto.iban, user: { id: userId } },
      relations: ['user'],
    });
    if (!entity) throw new NotFoundException('bankAccount not found');

    const update = this.bankAccountRepo.create(dto);

    Util.removeNullFields(entity);

    return await this.bankAccountRepo.save({ ...entity, ...update });
  }

  // --- HELPER METHODS --- //

  private async createBankAccountInternal(iban: string, userId: number, copyFrom?: BankAccount): Promise<BankAccount> {
    const bankAccount = copyFrom ? IEntity.copy(copyFrom) : await this.initBankAccount(iban);
    bankAccount.user = { id: userId } as User;

    return this.bankAccountRepo.save(bankAccount);
  }

  private async initBankAccount(iban: string): Promise<BankAccount> {
    const bankDetails = await this.ibanService.getIbanInfos(iban);
    return this.bankAccountRepo.create({ ...this.parseBankDetails(bankDetails), iban });
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
      acountNumber: this.parseString(bankDetails.account_number),
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
