import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DataSource } from 'typeorm';
import {
  FIAT_REPUBLIC_END_USER_DEAD_STATES,
  FiatRepublicCreateEndUserRequest,
  FiatRepublicEndUserResponse,
  FiatRepublicPerson,
} from '../dto/fiat-republic.dto';
import { FiatRepublicEndUser, FiatRepublicEndUserState } from '../entities/fiat-republic-end-user.entity';
import { FiatRepublicEndUserRepository } from '../repositories/fiat-republic-end-user.repository';
import { FiatRepublicNotCreatedError, FiatRepublicService } from './fiat-republic.service';

const LOCK_NAMESPACE = 'fiat-republic-end-user';

/**
 * Owns the exactly-once creation of a Fiat Republic end user for one DFX customer.
 *
 * Fiat Republic has no idempotency key on end-user creation, and a duplicate end user is not a
 * cosmetic problem: it splits one customer's virtual accounts across two identities, which breaks
 * both payin attribution and the AUP commitment that a customer's Fiat Republic footprint is a
 * single, reviewable object. The protocol is therefore the same shape as the Bank Frick virtual-IBAN
 * issuance:
 *
 * 1. A row claimed under a cross-instance advisory lock (unique on `userDataId`) is the mutex.
 * 2. The claim is committed as `InFlight` BEFORE the HTTP call, so a crash mid-call is visible.
 * 3. An ambiguous failure never issues a second POST — it recovers by listing, or fails closed.
 */
@Injectable()
export class FiatRepublicEndUserService {
  private readonly logger = new DfxLogger(FiatRepublicEndUserService);

  constructor(
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly endUserRepo: FiatRepublicEndUserRepository,
    private readonly dataSource: DataSource,
  ) {}

  /** Returns the usable end user id, creating it on demand. Throws (never returns null) on failure. */
  async getOrCreateEndUser(userDataId: number, person: FiatRepublicPerson, ipAddress: string): Promise<string> {
    if (!this.fiatRepublicService.isFrontendEnabled())
      throw new ServiceUnavailableException('Fiat Republic is not enabled');

    const claim = await this.claimEndUser(userDataId);
    if (claim.endUser.isUsable) return claim.endUser.endUserId;

    if (!claim.claimed) return this.resolveExistingClaim(claim.endUser, person);

    return this.createClaimedEndUser(claim.endUser, person, ipAddress);
  }

  /** Read-only lookup — used by callers that must not trigger a creation (e.g. payout resolution). */
  async findEndUserId(userDataId: number): Promise<string | undefined> {
    const endUser = await this.endUserRepo.findOneBy({ userDataId });
    return endUser?.isUsable ? endUser.endUserId : undefined;
  }

  // --- CLAIM HANDLING --- //

  private async claimEndUser(userDataId: number): Promise<{ endUser: FiatRepublicEndUser; claimed: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        LOCK_NAMESPACE,
        String(userDataId),
      ]);

      // ON CONFLICT DO NOTHING keeps a racing insert from the other side of the lock harmless; the
      // read below then observes whichever row won.
      await manager.query(
        `INSERT INTO "fiat_republic_end_user" ("userDataId", "state") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userDataId, FiatRepublicEndUserState.PENDING],
      );

      const endUser = await manager.findOne(FiatRepublicEndUser, { where: { userDataId } });
      if (!endUser) throw new Error(`Fiat Republic end user claim missing after insert (userDataId=${userDataId})`);

      if (endUser.isUsable || endUser.state !== FiatRepublicEndUserState.PENDING) return { endUser, claimed: false };

      endUser.state = FiatRepublicEndUserState.IN_FLIGHT;
      endUser.error = null;
      return { endUser: await manager.save(endUser), claimed: true };
    });
  }

  private async createClaimedEndUser(
    claim: FiatRepublicEndUser,
    person: FiatRepublicPerson,
    ipAddress: string,
  ): Promise<string> {
    const request: FiatRepublicCreateEndUserRequest = { person, ipAddress };

    let created: FiatRepublicEndUserResponse;
    try {
      created = await this.fiatRepublicService.createIndividualEndUser(request);
    } catch (error) {
      // A deterministic rejection proves nothing was created — release the claim so a corrected
      // retry can take it again. Everything else is ambiguous and goes through recovery.
      if (error instanceof FiatRepublicNotCreatedError) {
        await this.releaseClaim(claim.id, 'Fiat Republic end user create rejected');
        throw new ServiceUnavailableException('Fiat Republic end user creation failed');
      }

      return this.recoverEndUser(claim, person, error);
    }

    return this.completeClaim(claim.id, created);
  }

  /**
   * Recovery after an ambiguous create. A listing match is proof the POST landed; anything else
   * leaves the claim `InFlight` so no second create can ever be issued for this customer.
   */
  private async recoverEndUser(
    claim: FiatRepublicEndUser,
    person: FiatRepublicPerson,
    createError: unknown,
  ): Promise<string> {
    let candidates: FiatRepublicEndUserResponse[];
    try {
      candidates = await this.fiatRepublicService.listIndividualEndUsersByEmail(person.email);
    } catch (error) {
      this.logger.error(
        `Fiat Republic end user recovery listing failed (endUserRowId=${claim.id}, userDataId=${claim.userDataId})`,
        error instanceof Error ? error : undefined,
      );
      throw new ServiceUnavailableException('Fiat Republic end user creation failed');
    }

    const match = this.findMatch(candidates, person);
    if (!match) {
      // Empty listing is not proof of absence: a concurrent create may still be in flight. Leave the
      // claim InFlight and fail closed — a later call re-enters recovery, never a second create.
      this.logger.error(
        `Fiat Republic end user creation is unresolved; leaving the claim in flight ` +
          `(endUserRowId=${claim.id}, userDataId=${claim.userDataId})`,
        createError instanceof Error ? createError : undefined,
      );
      throw new ServiceUnavailableException('Fiat Republic end user creation failed');
    }

    return this.completeClaim(claim.id, match);
  }

  private async resolveExistingClaim(claim: FiatRepublicEndUser, person: FiatRepublicPerson): Promise<string> {
    if (claim.state === FiatRepublicEndUserState.FAILED)
      throw new ServiceUnavailableException('Fiat Republic end user creation failed');

    // InFlight (or a Completed row whose id never landed): recover, never re-create.
    return this.recoverEndUser(claim, person, undefined);
  }

  private findMatch(
    candidates: FiatRepublicEndUserResponse[],
    person: FiatRepublicPerson,
  ): FiatRepublicEndUserResponse | undefined {
    const matches = (candidates ?? []).filter(
      (candidate) =>
        candidate.id &&
        candidate.person?.email?.toLowerCase() === person.email.toLowerCase() &&
        candidate.person?.dob === person.dob &&
        !FIAT_REPUBLIC_END_USER_DEAD_STATES.includes(candidate.status),
    );

    // More than one live end user for the same person is exactly the ambiguity this protocol exists
    // to prevent — never pick one arbitrarily.
    if (matches.length !== 1) return undefined;
    return matches[0];
  }

  private async completeClaim(id: number, response: FiatRepublicEndUserResponse): Promise<string> {
    if (FIAT_REPUBLIC_END_USER_DEAD_STATES.includes(response.status)) {
      await this.failClaim(id, `Fiat Republic end user is ${response.status}`);
      throw new ServiceUnavailableException('Fiat Republic end user is not usable');
    }

    await this.endUserRepo.update(id, {
      endUserId: response.id,
      state: FiatRepublicEndUserState.COMPLETED,
      error: null,
    });
    return response.id;
  }

  private async releaseClaim(id: number, reason: string): Promise<void> {
    await this.endUserRepo.update(id, {
      state: FiatRepublicEndUserState.PENDING,
      error: reason.substring(0, 256),
    });
  }

  private async failClaim(id: number, reason: string): Promise<void> {
    await this.endUserRepo.update(id, {
      state: FiatRepublicEndUserState.FAILED,
      error: reason.substring(0, 256),
    });
  }
}
