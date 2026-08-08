import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import {
  FIAT_REPUBLIC_ACCOUNT_DEAD_STATES,
  FiatRepublicPerson,
  FiatRepublicVirtualAccountResponse,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicEndUserService } from 'src/integration/bank/services/fiat-republic-end-user.service';
import { FiatRepublicNotCreatedError, FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { IbanBankName } from '../../bank/dto/bank.dto';
import { VibanAccountHolder } from './viban-account-holder.enum';
import { ReservedViban, VibanNotCreatedError, VibanProvider } from './viban-provider.interface';

/** Everything the Fiat Republic issuance path needs, resolved once by the caller. */
export interface FiatRepublicVibanRequest {
  userDataId: number;
  person: FiatRepublicPerson;
  ipAddress: string;
  label?: string;
}

/** Bank details are assigned asynchronously — "usually no longer than a few seconds" per the docs. */
const ACTIVATION_POLL_ATTEMPTS = 8;
const ACTIVATION_POLL_INTERVAL_MS = 2_000;

@Injectable()
export class FiatRepublicVibanProvider implements VibanProvider {
  private readonly logger = new DfxLogger(FiatRepublicVibanProvider);

  readonly bankName = IbanBankName.FIAT_REPUBLIC;
  readonly currencies = ['EUR'];
  /**
   * Fiat Republic virtual accounts are named sub-accounts of DFX's client money account: the IBAN is
   * issued in the customer's own name, so the customer is who a payer must address.
   */
  readonly accountHolder = VibanAccountHolder.CUSTOMER;

  constructor(
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly endUserService: FiatRepublicEndUserService,
  ) {}

  isAvailable(): boolean {
    return this.fiatRepublicService.isFrontendEnabled() && !!Config.bank.fiatRepublic.masterFiatAccountId;
  }

  /**
   * Not reachable through the generic issuance path: Fiat Republic requires an end user object
   * before a virtual account can exist, and that needs customer data the generic signature does not
   * carry. `VirtualIbanService` routes this bank to {@link reserveVibanForUser} instead — the same
   * split Bank Frick uses for its claim/recovery protocol.
   */
  async reserveViban(): Promise<ReservedViban> {
    throw new ServiceUnavailableException('Fiat Republic virtual IBAN issuance requires an end user');
  }

  /**
   * Issues a named sub-account for one customer: end user first (exactly-once, see
   * `FiatRepublicEndUserService`), then the virtual account under DFX's master client money account.
   *
   * Both steps are idempotent by construction — the end user through its claim protocol, the virtual
   * account through a customer-derived idempotency key plus a recovery listing — so an ambiguous
   * failure never leaves a second IBAN behind for the same person.
   */
  async reserveVibanForUser(request: FiatRepublicVibanRequest): Promise<ReservedViban> {
    if (!this.isAvailable()) throw new ServiceUnavailableException('Fiat Republic service is not available');

    const endUserId = await this.endUserService.getOrCreateEndUser(
      request.userDataId,
      request.person,
      request.ipAddress,
    );

    let account: FiatRepublicVirtualAccountResponse;
    try {
      account = await this.fiatRepublicService.createVirtualAccount(
        {
          masterFiatAccountId: Config.bank.fiatRepublic.masterFiatAccountId,
          ibanCountry: Config.bank.fiatRepublic.ibanCountry,
          endUserId,
          label: request.label,
        },
        this.idempotencyKey(request.userDataId),
      );
    } catch (error) {
      if (error instanceof FiatRepublicNotCreatedError)
        throw new VibanNotCreatedError('Fiat Republic virtual account create rejected');

      // Ambiguous: the account may exist. Recover by listing before ever considering another create.
      const recovered = await this.findExistingAccount(endUserId);
      if (!recovered) {
        this.logger.error(
          `Fiat Republic virtual account creation is unresolved (userDataId=${request.userDataId})`,
          error instanceof Error ? error : undefined,
        );
        throw new ServiceUnavailableException('Fiat Republic virtual account creation failed');
      }
      account = recovered;
    }

    return this.awaitBankDetails(account, endUserId, request.userDataId);
  }

  // --- HELPER METHODS --- //

  private idempotencyKey(userDataId: number): string {
    return `dfx-fr-viban-${userDataId}`;
  }

  /**
   * Finds the single live virtual account of this end user under our master account. Fails closed on
   * ambiguity (more than one match) rather than picking arbitrarily — a wrong pick would hand the
   * customer an IBAN that belongs to a different account of theirs.
   */
  private async findExistingAccount(endUserId: string): Promise<FiatRepublicVirtualAccountResponse | undefined> {
    let accounts: FiatRepublicVirtualAccountResponse[];
    try {
      accounts = await this.fiatRepublicService.listVirtualAccountsByEndUser(endUserId);
    } catch (error) {
      this.logger.error(
        'Fiat Republic virtual account recovery listing failed',
        error instanceof Error ? error : undefined,
      );
      return undefined;
    }

    const masterFiatAccountId = Config.bank.fiatRepublic.masterFiatAccountId;
    const matches = (accounts ?? []).filter(
      (account) =>
        account.id &&
        account.masterFiatAccountId === masterFiatAccountId &&
        !FIAT_REPUBLIC_ACCOUNT_DEAD_STATES.includes(account.status),
    );

    if (matches.length !== 1) return undefined;
    return matches[0];
  }

  /**
   * A freshly created account is `CREATED` with `bankDetails: null` until the underlying bank
   * assigns the IBAN. Poll until it appears; an account without an IBAN is worthless to the customer
   * and must not be persisted as if it were usable.
   */
  private async awaitBankDetails(
    account: FiatRepublicVirtualAccountResponse,
    endUserId: string,
    userDataId: number,
  ): Promise<ReservedViban> {
    let current = account;

    for (let attempt = 0; attempt < ACTIVATION_POLL_ATTEMPTS; attempt++) {
      if (FIAT_REPUBLIC_ACCOUNT_DEAD_STATES.includes(current.status)) {
        this.logger.error(
          `Fiat Republic virtual account reached a dead state ${current.status} (userDataId=${userDataId})`,
        );
        throw new ServiceUnavailableException('Fiat Republic virtual account could not be activated');
      }

      if (current.bankDetails?.iban) {
        this.assertOwnership(current, endUserId, userDataId);
        return {
          iban: current.bankDetails.iban,
          providerAccountRef: current.id,
        };
      }

      await Util.delay(ACTIVATION_POLL_INTERVAL_MS);

      try {
        current = await this.fiatRepublicService.getVirtualAccount(current.id);
      } catch (error) {
        this.logger.error(
          `Fiat Republic virtual account activation poll failed (userDataId=${userDataId})`,
          error instanceof Error ? error : undefined,
        );
        throw new ServiceUnavailableException('Fiat Republic virtual account activation failed');
      }
    }

    // The account exists at Fiat Republic but has no IBAN yet. Fail closed without deleting it — a
    // later request recovers the same account through the listing above.
    this.logger.error(
      `Fiat Republic virtual account did not receive bank details in time (userDataId=${userDataId}, status=${current.status})`,
    );
    throw new ServiceUnavailableException('Fiat Republic virtual account is not ready');
  }

  /**
   * Guards against adopting an account that is not the one we asked for. Never logs the IBAN.
   */
  private assertOwnership(account: FiatRepublicVirtualAccountResponse, endUserId: string, userDataId: number): void {
    const masterFiatAccountId = Config.bank.fiatRepublic.masterFiatAccountId;
    if (account.owner?.id === endUserId && account.masterFiatAccountId === masterFiatAccountId) return;

    this.logger.error(
      `Fiat Republic virtual account binding mismatch (userDataId=${userDataId}, virtualAccountId=${account.id})`,
    );
    throw new ServiceUnavailableException('Fiat Republic virtual account binding mismatch');
  }
}
