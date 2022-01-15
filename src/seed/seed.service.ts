import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Wallet } from 'src/user/models/wallet/wallet.entity';
import { EntityManager, EntityTarget } from 'typeorm';
import { AssetSeed } from './asset.seed';
import { CountrySeed } from './country.seed';
import { FiatSeed } from './fiat.seed';
import { LanguageSeed } from './language.seed';
import { WalletSeed } from './wallet.seed';

@Injectable()
export class SeedService {
  private readonly seeds: { entity: EntityTarget<any>; seed: any[]; key: string }[];

  constructor(private readonly entityManager: EntityManager) {
    this.seeds = [
      { entity: Asset, seed: AssetSeed, key: 'name' },
      { entity: Country, seed: CountrySeed, key: 'symbol' },
      { entity: Fiat, seed: FiatSeed, key: 'name' },
      { entity: Language, seed: LanguageSeed, key: 'symbol' },
      { entity: Wallet, seed: WalletSeed, key: 'description' },
    ];
    this.seed().then();
  }

  async seed(): Promise<void> {
    for (const seed of this.seeds) {
      const existing = await this.entityManager.find(seed.entity);
      const entitiesToAdd = seed.seed
        .filter((f) => existing.find((e) => f[seed.key] === e[seed.key]) == null)
        .map((e) => this.entityManager.create(seed.entity, e));

      if (entitiesToAdd.length > 0) {
        console.log('New entities seeded:', entitiesToAdd);
        // TODO: enable
        // await this.entityManager.save(entitiesToAdd);
      }
    }
  }
}
