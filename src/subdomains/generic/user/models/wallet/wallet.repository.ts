import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { Wallet } from './wallet.entity';

/** The four values `KycService.toKycDataDto` reads per user of the wallet. */
export const WALLET_KYC_DATA_RESPONSE_FIELDS = [
  'walletUser.address',
  'walletUserData.kycStatus',
  'walletUserData.kycType',
  'walletUserData.kycHash',
];

/**
 * `GET /kyc/users` — the KYC state of every user on a wallet.
 *
 * Loading the wallet with `relations: { users: { userData: true } }` reaches 328 columns per user,
 * for an address, two status fields and a hash.
 */
export const WALLET_KYC_DATA_PROJECTION = new ReadProjection<Wallet>(
  'wallet',
  [
    ['wallet.users', 'walletUser'],
    ['walletUser.userData', 'walletUserData'],
  ],
  WALLET_KYC_DATA_RESPONSE_FIELDS,
  // Never part of the response: the primary keys that make the ORM materialise the joined rows.
  ['wallet.id', 'walletUser.id', 'walletUserData.id'],
);

@Injectable()
export class WalletRepository extends CachedRepository<Wallet> {
  constructor(manager: EntityManager) {
    super(Wallet, manager);
  }

  /**
   * A wallet with its users' KYC state, and nothing else.
   *
   * `fields` exists for the mutation test; nothing in production passes it.
   */
  async findKycData(
    walletId: number,
    fields: ReadonlyArray<string> = WALLET_KYC_DATA_PROJECTION.fields,
  ): Promise<Wallet> {
    return WALLET_KYC_DATA_PROJECTION.apply(this.createQueryBuilder('wallet'), fields)
      .where('wallet.id = :walletId', { walletId })
      .getOne();
  }

  async getByAddress(address: string): Promise<Wallet> {
    return this.findOneBy({ address });
  }
}
