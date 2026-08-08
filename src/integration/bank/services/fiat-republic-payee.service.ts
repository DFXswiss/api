import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { DataSource } from 'typeorm';
import {
  FIAT_REPUBLIC_PAYEE_DEAD_STATES,
  FiatRepublicAddress,
  FiatRepublicMatchLevel,
  FiatRepublicPayeeResponse,
  FiatRepublicPayeeStatus,
  FiatRepublicPayeeType,
  FiatRepublicPayeeVerificationResponse,
  FiatRepublicVerificationStatus,
} from '../dto/fiat-republic.dto';
import { FiatRepublicPayee } from '../entities/fiat-republic-payee.entity';
import { FiatRepublicPayeeRepository } from '../repositories/fiat-republic-payee.repository';
import { FiatRepublicNotCreatedError, FiatRepublicService } from './fiat-republic.service';

export interface FiatRepublicPayeeRequest {
  endUserId: string;
  name: string;
  iban: string;
  bic?: string;
  address: FiatRepublicAddress;
  type?: FiatRepublicPayeeType;
}

/** A newly created payee becomes ACTIVE "typically within a couple of seconds". */
const PAYEE_POLL_ATTEMPTS = 6;
const PAYEE_POLL_INTERVAL_MS = 2_000;
const LOCK_NAMESPACE = 'fiat-republic-payee';

/**
 * Creates and reuses Fiat Republic payees, and produces the Verification of Payee (VoP) id that
 * every SEPA EUR payout needs.
 *
 * Payees are long-lived and reusable; verifications are not. A verification is single-use, expires
 * after ten minutes and is consumed by the payment it authorises, so it is deliberately NOT cached —
 * it is created immediately before each payout and never reused.
 */
@Injectable()
export class FiatRepublicPayeeService {
  private readonly logger = new DfxLogger(FiatRepublicPayeeService);

  constructor(
    private readonly fiatRepublicService: FiatRepublicService,
    private readonly payeeRepo: FiatRepublicPayeeRepository,
    private readonly dataSource: DataSource,
  ) {}

  /** Returns an ACTIVE payee id for this (end user, IBAN, name), creating it once if needed. */
  async getOrCreatePayee(request: FiatRepublicPayeeRequest): Promise<string> {
    if (!this.fiatRepublicService.isPayoutEnabled())
      throw new ServiceUnavailableException('Fiat Republic payouts are not enabled');

    const iban = this.normalizeIban(request.iban);
    const name = request.name.trim();

    const claim = await this.claimPayee(request.endUserId, iban, name);
    if (claim.payeeId) return this.awaitActive(claim.payeeId, claim.id);

    let created: FiatRepublicPayeeResponse;
    try {
      created = await this.fiatRepublicService.createPayee(
        {
          endUserId: request.endUserId,
          type: request.type ?? FiatRepublicPayeeType.PERSON,
          name,
          currency: 'EUR',
          address: request.address,
          bankDetails: { iban, ...(request.bic && { bic: request.bic }) },
        },
        // Derived from the claim row, which the unique index binds to exactly this
        // (end user, IBAN, name). A retry after an ambiguous failure, and a second concurrent
        // payout to the same beneficiary, therefore both reach the original payee instead of
        // creating a duplicate — the local claim row alone cannot prevent that, because it
        // carries no in-flight marker for a payee whose id never landed.
        `dfx-fr-payee-${claim.id}`,
      );
    } catch (error) {
      if (error instanceof FiatRepublicNotCreatedError) {
        await this.payeeRepo.delete(claim.id);
        throw new ServiceUnavailableException('Fiat Republic payee create rejected');
      }
      // Ambiguous — the payee may exist. Keep the claim row: the next attempt reuses it, and with it
      // the same idempotency key, so a repeated create resolves to the original payee.
      this.logger.error('Fiat Republic payee creation is unresolved', error instanceof Error ? error : undefined);
      throw new ServiceUnavailableException('Fiat Republic payee creation failed');
    }

    await this.payeeRepo.update(claim.id, { payeeId: created.id, status: created.status });
    return this.awaitActive(created.id, claim.id, created);
  }

  /**
   * Runs the SEPA EUR Verification of Payee and returns an id usable for exactly one payment.
   *
   * A `CLOSE_MATCH`/`NO_MATCH` is a definitive answer from the beneficiary bank, not an error, and
   * it is accepted automatically: the payee here is not customer-entered data but an IBAN DFX itself
   * holds under KYC for that customer, and requiring a manual confirmation for every name spelling
   * difference would make automated payouts impossible. The observed match level is returned so the
   * caller can persist it — the decision stays auditable on the payout row.
   */
  async createVerification(payeeId: string): Promise<{ verificationId: string; matchLevel: FiatRepublicMatchLevel }> {
    let verification: FiatRepublicPayeeVerificationResponse;
    try {
      verification = await this.fiatRepublicService.verifyPayee(payeeId);
    } catch (error) {
      // "Payee couldn't be verified" means the beneficiary bank could not answer at all (not on the
      // VoP network, account not yet published). That is not a rejection of the payout, but without
      // a verification id Fiat Republic will not accept the payment — fail closed and retry later.
      this.logger.error('Fiat Republic payee verification failed', error instanceof Error ? error : undefined);
      throw new ServiceUnavailableException('Fiat Republic payee verification failed');
    }

    const matchLevel = verification.matchResult?.matchLevel ?? FiatRepublicMatchLevel.NO_MATCH;

    if (
      verification.status === FiatRepublicVerificationStatus.ACCEPTED ||
      verification.status === FiatRepublicVerificationStatus.EXEMPT
    )
      return { verificationId: verification.id, matchLevel };

    if (verification.status !== FiatRepublicVerificationStatus.PENDING_CUSTOMER_REVIEW) {
      this.logger.error(`Fiat Republic payee verification is in unexpected status ${verification.status}`);
      throw new ServiceUnavailableException('Fiat Republic payee verification is not usable');
    }

    const reviewed = await this.fiatRepublicService.reviewPayeeVerification(verification.id, true);
    if (
      reviewed.status !== FiatRepublicVerificationStatus.ACCEPTED &&
      reviewed.status !== FiatRepublicVerificationStatus.EXEMPT
    ) {
      this.logger.error(`Fiat Republic payee verification review returned status ${reviewed.status}`);
      throw new ServiceUnavailableException('Fiat Republic payee verification is not usable');
    }

    return { verificationId: reviewed.id, matchLevel };
  }

  // --- HELPER METHODS --- //

  private normalizeIban(iban: string): string {
    return iban.replace(/\s/g, '').toUpperCase();
  }

  /**
   * Claims the (end user, IBAN, name) triple under a cross-instance lock. The unique index is what
   * makes a racing second caller reuse the row instead of creating a second payee at Fiat Republic.
   */
  private async claimPayee(endUserId: string, iban: string, name: string): Promise<FiatRepublicPayee> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        LOCK_NAMESPACE,
        `${endUserId}:${iban}:${name}`,
      ]);

      await manager.query(
        `INSERT INTO "fiat_republic_payee" ("endUserId", "iban", "name") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [endUserId, iban, name],
      );

      const payee = await manager.findOne(FiatRepublicPayee, { where: { endUserId, iban, name } });
      if (!payee) throw new Error('Fiat Republic payee claim missing after insert');
      return payee;
    });
  }

  /**
   * Waits for the payee to reach ACTIVE. A payment to a non-active payee is rejected, so this is a
   * precondition rather than an optimisation.
   */
  private async awaitActive(payeeId: string, rowId: number, known?: FiatRepublicPayeeResponse): Promise<string> {
    let current = known;

    for (let attempt = 0; attempt < PAYEE_POLL_ATTEMPTS; attempt++) {
      if (current) {
        if (FIAT_REPUBLIC_PAYEE_DEAD_STATES.includes(current.status)) {
          await this.payeeRepo.update(rowId, { status: current.status });
          this.logger.error(`Fiat Republic payee reached a dead state ${current.status}`);
          throw new ServiceUnavailableException('Fiat Republic payee is not usable');
        }

        if (current.status === FiatRepublicPayeeStatus.ACTIVE) {
          await this.payeeRepo.update(rowId, { status: current.status });
          return payeeId;
        }
      }

      await Util.delay(PAYEE_POLL_INTERVAL_MS);

      try {
        current = await this.fiatRepublicService.getPayee(payeeId);
      } catch (error) {
        this.logger.error('Fiat Republic payee status poll failed', error instanceof Error ? error : undefined);
        throw new ServiceUnavailableException('Fiat Republic payee status could not be resolved');
      }
    }

    // The payee exists but is not usable yet. Keep the row so the next attempt reuses it.
    await this.payeeRepo.update(rowId, { status: current?.status });
    throw new ServiceUnavailableException('Fiat Republic payee is not active yet');
  }
}
