import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { VibanAccountHolder } from './viban-account-holder.enum';
import { ReservedViban, VibanProvider } from './viban-provider.interface';

@Injectable()
export class YapealVibanProvider implements VibanProvider {
  readonly bankName = IbanBankName.YAPEAL;
  readonly currencies = ['CHF'];
  readonly accountHolder = VibanAccountHolder.CUSTOMER;

  constructor(private readonly yapealService: YapealService) {}

  isAvailable(): boolean {
    return this.yapealService.isAvailable();
  }

  async reserveViban(baseAccountIban: string): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Yapeal service is not available');

    const result = await this.yapealService.createViban(baseAccountIban);

    return { iban: result.iban, bban: result.bban, providerAccountRef: result.accountUid };
  }
}
