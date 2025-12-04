import { Injectable } from '@nestjs/common';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Bank } from '../bank/bank.entity';
import { VirtualIban, VirtualIbanStatus } from './virtual-iban.entity';
import { VirtualIbanRepository } from './virtual-iban.repository';

@Injectable()
export class VirtualIbanService {
  constructor(private readonly virtualIbanRepo: VirtualIbanRepository) {}

  async getByUserData(userData: UserData): Promise<VirtualIban[]> {
    return this.virtualIbanRepo.findBy({ userData: { id: userData.id }, active: true });
  }

  async getByIban(iban: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneBy({ iban });
  }

  async getById(id: number): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneBy({ id });
  }

  async getActiveForUserAndCurrency(userDataId: number, currencyName: string): Promise<VirtualIban | null> {
    return this.virtualIbanRepo.findOneCached(`${userDataId}-${currencyName}`, {
      where: {
        userData: { id: userDataId },
        currency: { name: currencyName },
        active: true,
        status: VirtualIbanStatus.ACTIVE,
      },
    });
  }

  async create(
    userData: UserData,
    bank: Bank,
    currency: Fiat,
    iban: string,
    bban?: string,
    yapealAccountUid?: string,
  ): Promise<VirtualIban> {
    const virtualIban = this.virtualIbanRepo.create({
      userData,
      bank,
      currency,
      iban,
      bban,
      yapealAccountUid,
      status: VirtualIbanStatus.RESERVED,
      active: true,
    });

    return this.virtualIbanRepo.save(virtualIban);
  }

  async activate(virtualIban: VirtualIban): Promise<VirtualIban> {
    virtualIban.status = VirtualIbanStatus.ACTIVE;
    virtualIban.activatedAt = new Date();
    return this.virtualIbanRepo.save(virtualIban);
  }

  async deactivate(virtualIban: VirtualIban): Promise<VirtualIban> {
    virtualIban.status = VirtualIbanStatus.DEACTIVATED;
    virtualIban.deactivatedAt = new Date();
    virtualIban.active = false;
    return this.virtualIbanRepo.save(virtualIban);
  }
}
