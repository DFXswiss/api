import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FrickVirtualIban, FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
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

  async reserveViban(baseAccountIban: string, description?: string): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');

    const created = await this.bankFrickService.createViban(baseAccountIban, description);
    return this.ensureActive(created);
  }

  /**
   * Finds a PREPARED/ACTIVE Frick vIBAN by exact description (issuance request reference).
   * Returns undefined when none match; throws ServiceUnavailable when more than one match
   * (fail-closed — never pick arbitrarily).
   */
  async findRecoverableByDescription(
    description: string,
    referenceAccountIban: string,
  ): Promise<FrickVirtualIban | undefined> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    if (typeof description !== 'string' || !description.trim())
      throw new ServiceUnavailableException('Bank Frick virtual IBAN recovery reference is missing');

    const all = await this.bankFrickService.listAllVibans(referenceAccountIban, [
      FrickVirtualIbanState.PREPARED,
      FrickVirtualIbanState.ACTIVE,
    ]);
    const normalizedReferenceAccountIban = referenceAccountIban.replace(/\s/g, '').toUpperCase();

    const matches = all.filter(
      (viban) => viban.description === description && viban.referenceAccountIban === normalizedReferenceAccountIban,
    );
    if (matches.length === 0) return undefined;
    if (matches.length > 1)
      throw new ServiceUnavailableException(
        'Bank Frick virtual IBAN recovery found multiple matches for the same reference',
      );

    return matches[0];
  }

  async adoptAndActivate(viban: FrickVirtualIban): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    return this.ensureActive(viban);
  }

  private async ensureActive(created: FrickVirtualIban): Promise<ReservedViban> {
    const activated =
      created.state === FrickVirtualIbanState.ACTIVE
        ? created
        : await this.bankFrickService.approveVibanActivation(created.vban);

    if (activated.state !== FrickVirtualIbanState.ACTIVE)
      throw new Error(`Bank Frick virtual IBAN ${created.vban} could not be activated (state: ${activated.state})`);

    return { iban: activated.vban, providerAccountRef: activated.vban };
  }
}
