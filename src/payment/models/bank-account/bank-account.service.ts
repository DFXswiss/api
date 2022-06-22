import { Injectable } from '@nestjs/common';
import { IbanService } from 'src/shared/services/iban.service';
import { User } from 'src/user/models/user/user.entity';
import { BankAccount } from './bank-account.entity';
import { BankAccountRepository } from './bank-account.repository';
import { IbanDetails } from 'src/shared/services/iban.service';
import { BankAccountDto } from './dto/bank-account.dto';

@Injectable()
export class BankAccountService {
  constructor(private readonly bankAccountRepo: BankAccountRepository, private readonly ibanService: IbanService) {}

  async getBankAccount(iban: string, userId: number): Promise<BankAccount> {
    const bankAccount = await this.bankAccountRepo.findOne({
      where: {
        iban: iban,
      },
      relations: ['user'],
    });

    if (!bankAccount) {
      const bankDetails = await this.ibanService.getIbanInfos(iban);

      const bankAccount = this.bankAccountRepo.create(this.parseBankDetails(bankDetails));

      bankAccount.iban = iban;
      bankAccount.user = { id: userId } as User;

      return this.bankAccountRepo.save(bankAccount);
    }

    if (bankAccount.user.id != userId) {
      bankAccount.user = { id: userId } as User;
      delete bankAccount.id;
      return this.bankAccountRepo.save(bankAccount);
    }

    return bankAccount;
  }

  private parseBankDetails(bankDetails: IbanDetails): BankAccountDto {
    return {
      bic: bankDetails.bic_candidates.length > 0 ? bankDetails.bic_candidates.map((c) => c.bic).join(',') : null,
      bankName: this.parseString(bankDetails.bank),
      allBicCandidates:
        bankDetails.all_bic_candidates.length > 0 ? bankDetails.all_bic_candidates.map((c) => c.bic).join(',') : null,
      country: this.parseString(bankDetails.country),
      bankCode: this.parseString(bankDetails.bank_code),
      bankAndBranchCode: this.parseString(bankDetails.bank_and_branch_code),
      bankAddress: this.parseString(bankDetails.bank_address),
      bankCity: this.parseString(bankDetails.bank_city),
      bankState: this.parseString(bankDetails.bank_state),
      bankPostalCode: this.parseString(bankDetails.bank_postal_code),
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
    };
  }

  private parseString(temp: string): string {
    return !temp ? null : temp;
  }

  private parseBoolean(temp: string): boolean {
    return !temp ? null : temp === 'yes' ? true : false;
  }
}
