import { ConflictException, Injectable } from '@nestjs/common';
import { CreateBuyDto } from 'src/payment/models/buy/dto/create-buy.dto';
import { IbanService } from 'src/shared/services/iban.service';
import { User } from 'src/user/models/user/user.entity';
import { BankAccount } from './bank-account.entity';
import { BankAccountRepository } from './bank-account.repository';

@Injectable()
export class BankAccountService {
  constructor(private readonly bankAccountRepo: BankAccountRepository, private readonly ibanService: IbanService) {}

  async getBankAccount(iban: string, userId: number): Promise<BankAccount> {
    const bankAccount = await this.bankAccountRepo.findOne({
      where: {
        iban: iban,
      },
    });

    if (!bankAccount) {
      const bankDetails = await this.ibanService.getIbanInfos(iban);

      const bankAccount = this.bankAccountRepo.create();

      bankAccount.iban = iban;
      bankAccount.user = { id: userId } as User;
      // TODO bankDetails speichern

      return this.bankAccountRepo.save(bankAccount);
    }

    if (bankAccount.user.id != userId) {
      bankAccount.user = { id: userId } as User;
      return this.bankAccountRepo.save(bankAccount);
    }

    return bankAccount;
  }
}
