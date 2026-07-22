import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { ReservedViban, VibanProvider } from './viban-provider.interface';

@Injectable()
export class FrickVibanProvider implements VibanProvider {
  readonly bankName = IbanBankName.FRICK;
  readonly currencies = ['EUR'];

  constructor(private readonly bankFrickService: BankFrickService) {}

  isAvailable(): boolean {
    return this.bankFrickService.isVibanAvailable();
  }

  async reserveViban(baseAccountIban: string): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');

    const created = await this.bankFrickService.createViban(baseAccountIban);
    const activated =
      created.state === FrickVirtualIbanState.ACTIVE
        ? created
        : await this.bankFrickService.approveVibanActivation(created.vban);

    if (activated.state !== FrickVirtualIbanState.ACTIVE)
      throw new Error(`Bank Frick virtual IBAN ${created.vban} could not be activated (state: ${activated.state})`);

    return { iban: activated.vban, providerAccountRef: activated.vban };
  }
}
