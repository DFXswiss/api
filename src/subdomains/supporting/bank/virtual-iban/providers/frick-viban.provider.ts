import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FrickVirtualIban, FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import { BankFrickService, FrickVibanNotCreatedError } from 'src/integration/bank/services/frick.service';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { ReservedViban, VibanNotCreatedError, VibanProvider } from './viban-provider.interface';

@Injectable()
export class FrickVibanProvider implements VibanProvider {
  readonly bankName = IbanBankName.FRICK;
  readonly currencies = ['EUR'];

  constructor(private readonly bankFrickService: BankFrickService) {}

  isAvailable(): boolean {
    return this.bankFrickService.isVibanAvailable();
  }

  async prepareVibanReservation(baseAccountIban: string, description: string): Promise<void> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    try {
      await this.bankFrickService.prepareVibanCreate(baseAccountIban, description);
    } catch {
      throw new ServiceUnavailableException('Bank Frick virtual IBAN preflight failed');
    }
  }

  async reserveViban(baseAccountIban: string, description?: string): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');

    let created: FrickVirtualIban;
    try {
      created = await this.bankFrickService.createViban(baseAccountIban, description);
    } catch (error) {
      if (error instanceof FrickVibanNotCreatedError) throw new VibanNotCreatedError(error.message);
      throw new ServiceUnavailableException('Bank Frick virtual IBAN creation failed');
    }
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

    let all: FrickVirtualIban[];
    try {
      all = await this.bankFrickService.listAllVibans(referenceAccountIban, [
        FrickVirtualIbanState.PREPARED,
        FrickVirtualIbanState.ACTIVE,
      ]);
    } catch {
      throw new ServiceUnavailableException('Bank Frick virtual IBAN recovery failed');
    }
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
    let activated: FrickVirtualIban;
    try {
      activated =
        created.state === FrickVirtualIbanState.ACTIVE
          ? created
          : await this.bankFrickService.approveVibanActivation(created.vban);
    } catch {
      throw new ServiceUnavailableException('Bank Frick virtual IBAN activation failed');
    }

    if (activated.state !== FrickVirtualIbanState.ACTIVE)
      throw new ServiceUnavailableException(
        `Bank Frick virtual IBAN ${created.vban} could not be activated (state: ${activated.state})`,
      );

    return { iban: activated.vban, providerAccountRef: activated.vban };
  }
}
