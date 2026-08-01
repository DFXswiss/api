import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { Util } from 'src/shared/utils/util';
import { EntityManager, Raw, Repository } from 'typeorm';
import { KycLevel } from '../user-data/user-data.enum';
import { User } from './user.entity';

/** What `GET /kyc/:id/documents` needs off the account row: the id the document store is keyed by. */
export const USER_KYC_FILES_RESPONSE_FIELDS = ['kycFilesUserData.id'];

/**
 * `GET /kyc/:id/documents` — resolves the account behind an address on a wallet.
 *
 * The wallet is joined for the filter only; nothing of it reaches the response.
 */
export const USER_KYC_FILES_PROJECTION = new ReadProjection<User>(
  'user',
  [
    ['user.userData', 'kycFilesUserData'],
    ['user.wallet', 'kycFilesWallet'],
  ],
  USER_KYC_FILES_RESPONSE_FIELDS,
  ['user.id'],
);

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(manager: EntityManager) {
    super(User, manager);
  }

  /**
   * The account behind an address on a wallet, loaded with the account id only.
   *
   * `GET /kyc/:id/documents` reads nothing else off the row: the response is assembled from the
   * document store, keyed by that id. The unprojected load reaches 328 columns for it.
   *
   * `fields` is what the mutation test in `kyc-data.projection.spec.ts` re-runs the query with;
   * `KycService` calls this without it.
   */
  async findAccountIdForAddress(
    address: string,
    walletId: number,
    fields: ReadonlyArray<string> = USER_KYC_FILES_PROJECTION.fields,
  ): Promise<User> {
    return USER_KYC_FILES_PROJECTION.apply(this.createQueryBuilder('user'), fields)
      .where('user.address = :address', { address })
      .andWhere('kycFilesWallet.id = :walletId', { walletId })
      .getOne();
  }

  async setUserRef(user: User, kycLevel: KycLevel, manager?: EntityManager): Promise<void> {
    if (!user.ref && kycLevel >= KycLevel.LEVEL_50) {
      const repo = manager?.getRepository(User) ?? this;
      let ref = await this.getNextRef(repo);
      // retry (in case of ref conflict)
      await Util.retry(
        () => repo.update(...user.setRef(ref)),
        3,
        0,
        async () => (ref = await this.getNextRef(repo)),
      );
    }
  }

  private async getNextRef(repo: Repository<User>): Promise<string> {
    // get highest numerical ref
    const nextRef = await repo
      .findOne({
        select: { id: true, ref: true },
        where: { ref: Raw((alias) => `${alias} ~ '^[0-9]{3}-[0-9]{3}$'`) },
        order: { ref: 'DESC' },
      })
      .then((u) => +u.ref.replace('-', '') + 1);

    const ref = nextRef.toString().padStart(6, '0');
    return `${ref.slice(0, 3)}-${ref.slice(3, 6)}`;
  }
}
