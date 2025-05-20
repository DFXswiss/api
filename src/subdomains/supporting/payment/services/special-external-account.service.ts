import { BadRequestException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { CreateSpecialExternalAccountDto } from '../dto/input/create-special-external-account.dto';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async createSpecialExternalAccount(dto: CreateSpecialExternalAccountDto): Promise<SpecialExternalAccount> {
    const existing = await this.specialExternalAccountRepo.findOneBy({
      type: dto.type,
      value: dto.value,
    });
    if (existing) throw new BadRequestException('Special external account already created');

    const specialExternalAccount = this.specialExternalAccountRepo.create(dto);

    return this.specialExternalAccountRepo.save(specialExternalAccount);
  }

  async getMultiAccounts(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findCachedBy(`MultiAccountIbans`, {
      type: In([SpecialExternalAccountType.MULTI_ACCOUNT_IBAN, SpecialExternalAccountType.MULTI_ACCOUNT_BANK_NAME]),
    });
  }

  async getMultiAccountIbans(): Promise<string[]> {
    return this.getMultiAccounts().then((list) =>
      list.filter((a) => a.type === SpecialExternalAccountType.MULTI_ACCOUNT_IBAN).map((a) => a.value),
    );
  }

  async getBlacklist(types?: SpecialExternalAccountType[]): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findCachedBy(`Blacklist-${types?.toString()}`, {
      type: In(
        types ?? [
          SpecialExternalAccountType.BANNED_IBAN,
          SpecialExternalAccountType.BANNED_IBAN_BUY,
          SpecialExternalAccountType.BANNED_IBAN_SELL,
          SpecialExternalAccountType.BANNED_IBAN_AML,
          SpecialExternalAccountType.BANNED_BIC,
          SpecialExternalAccountType.BANNED_BIC_BUY,
          SpecialExternalAccountType.BANNED_BIC_SELL,
          SpecialExternalAccountType.BANNED_BIC_AML,
          SpecialExternalAccountType.BANNED_MAIL,
          SpecialExternalAccountType.BANNED_ACCOUNT_IBAN,
        ],
      ),
    });
  }
}
