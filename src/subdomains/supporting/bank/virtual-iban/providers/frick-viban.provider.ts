import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FrickVirtualIban, FrickVirtualIbanState } from 'src/integration/bank/dto/frick-vban.dto';
import {
  BankFrickService,
  FrickVibanNotCreatedError,
  FrickVirtualIbansFetchResult,
} from 'src/integration/bank/services/frick.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { VibanAccountHolder } from './viban-account-holder.enum';
import { ReservedViban, VibanNotCreatedError, VibanProvider } from './viban-provider.interface';

@Injectable()
export class FrickVibanProvider implements VibanProvider {
  private readonly logger = new DfxLogger(FrickVibanProvider);

  readonly bankName = IbanBankName.FRICK;
  readonly currencies = ['EUR'];
  readonly accountHolder = VibanAccountHolder.DFX;

  constructor(private readonly bankFrickService: BankFrickService) {}

  isAvailable(): boolean {
    return this.bankFrickService.isVibanAvailable();
  }

  async prepareVibanReservation(baseAccountIban: string, description: string): Promise<void> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    try {
      await this.bankFrickService.prepareVibanCreate(baseAccountIban, description);
    } catch (error) {
      // Log only a classified reason; upstream Error.message can still carry request path shape after
      // frick.service sanitization, but never re-embed it into the thrown exception (persisted / alerted).
      this.logger.error('Bank Frick virtual IBAN preflight failed', error instanceof Error ? error : undefined);
      throw new ServiceUnavailableException('Bank Frick virtual IBAN preflight failed');
    }
  }

  async reserveViban(baseAccountIban: string, description?: string): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    if (typeof description !== 'string' || !description.trim())
      throw new ServiceUnavailableException('Bank Frick virtual IBAN issuance reference is missing');

    let created: FrickVirtualIban;
    try {
      created = await this.bankFrickService.createViban(baseAccountIban, description);
    } catch (error) {
      // Fixed classification only — never the upstream message (may include path/query metadata).
      if (error instanceof FrickVibanNotCreatedError)
        throw new VibanNotCreatedError('Bank Frick virtual IBAN create rejected');
      this.logger.error('Bank Frick virtual IBAN creation failed', error instanceof Error ? error : undefined);
      throw new ServiceUnavailableException('Bank Frick virtual IBAN creation failed');
    }
    return this.ensureActive(created, baseAccountIban, description);
  }

  /**
   * Lists Frick vIBANs in every lifecycle state for a reference account.
   *
   * Reconciliation needs the bank's broadest available evidence: an object under the technical
   * description remains evidence of an earlier create even when it is already deactivated or has a
   * deactivation pending. Listing absence is still not authoritative; callers retain that risk.
   */
  async listByReferenceAccount(referenceAccountIban: string): Promise<FrickVirtualIbansFetchResult> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    if (typeof referenceAccountIban !== 'string' || !referenceAccountIban.trim())
      throw new ServiceUnavailableException('Bank Frick virtual IBAN reference account is missing');

    try {
      return await this.bankFrickService.listAllVibans(referenceAccountIban, undefined, 50);
    } catch (error) {
      this.logger.error('Bank Frick virtual IBAN listing failed', error instanceof Error ? error : undefined);
      throw new ServiceUnavailableException('Bank Frick virtual IBAN listing failed');
    }
  }

  /**
   * Finds a PREPARED/ACTIVE Frick vIBAN by exact description (issuance request reference).
   * Returns undefined when none match; throws ServiceUnavailable when more than one match
   * (fail-closed — never pick arbitrarily).
   *
   * Does not surface {@link FrickVirtualIbansFetchResult.fullyValidated}: the request-path recovery
   * already fails closed on empty / ambiguous results (no rotate-and-retry). An incomplete listing
   * can only produce empty or a positive match among well-formed entries; both are safe under that
   * contract. The reconciliation job uses {@link listByReferenceAccount} when it needs the signal.
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
      const result = await this.bankFrickService.listAllVibans(
        referenceAccountIban,
        [FrickVirtualIbanState.PREPARED, FrickVirtualIbanState.ACTIVE],
        50,
      );
      all = result.virtualIbans;
    } catch (error) {
      this.logger.error('Bank Frick virtual IBAN recovery failed', error instanceof Error ? error : undefined);
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

  async adoptAndActivate(
    viban: FrickVirtualIban,
    expectedReferenceAccountIban: string,
    expectedDescription: string,
  ): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Bank Frick virtual IBAN service is not available');
    return this.ensureActive(viban, expectedReferenceAccountIban, expectedDescription);
  }

  private async ensureActive(
    created: FrickVirtualIban,
    expectedReferenceAccountIban: string,
    expectedDescription: string,
  ): Promise<ReservedViban> {
    const normalizedReferenceAccountIban = expectedReferenceAccountIban.replace(/\s/g, '').toUpperCase();
    this.assertResponseBinding(created, normalizedReferenceAccountIban, expectedDescription, 'create');

    let activated: FrickVirtualIban;
    try {
      activated =
        created.state === FrickVirtualIbanState.ACTIVE
          ? created
          : await this.bankFrickService.approveVibanActivation(created.vban);
    } catch (error) {
      this.logger.error('Bank Frick virtual IBAN activation failed', error instanceof Error ? error : undefined);
      throw new ServiceUnavailableException('Bank Frick virtual IBAN activation failed');
    }

    if (activated.vban !== created.vban) {
      this.logger.error(
        `Bank Frick virtual IBAN activation identity mismatch (createdLength=${created.vban.length}, activatedLength=${activated.vban.length})`,
      );
      throw new ServiceUnavailableException(
        `Bank Frick virtual IBAN activation identity mismatch (createdLength=${created.vban.length}, activatedLength=${activated.vban.length})`,
      );
    }
    this.assertResponseBinding(activated, normalizedReferenceAccountIban, expectedDescription, 'activation');

    if (activated.state !== FrickVirtualIbanState.ACTIVE)
      throw new ServiceUnavailableException(
        `Bank Frick virtual IBAN could not be activated (state: ${activated.state}, vbanLength=${created.vban.length})`,
      );

    return { iban: activated.vban, providerAccountRef: activated.vban };
  }

  private assertResponseBinding(
    response: FrickVirtualIban,
    expectedReferenceAccountIban: string,
    expectedDescription: string,
    phase: 'create' | 'activation',
  ): void {
    if (
      response.referenceAccountIban === expectedReferenceAccountIban &&
      response.description === expectedDescription
    ) {
      return;
    }

    this.logger.error(`Bank Frick virtual IBAN ${phase} response binding mismatch`);
    throw new ServiceUnavailableException(`Bank Frick virtual IBAN ${phase} response binding mismatch`);
  }
}
