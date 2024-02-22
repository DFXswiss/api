import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Price } from './price';

export enum PriceSource {
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  COIN_GECKO = 'CoinGecko',
  DEX = 'DEX',
  FIXER = 'Fixer',
  CURRENCY = 'Currency',
  FRANKENCOIN = 'Frankencoin',
}

export interface Rule {
  source: PriceSource;
  asset: string;
  reference: string;
  limit?: number;
}

@Entity()
export class PriceRule extends IEntity {
  @OneToMany(() => Asset, (a) => a.priceRule)
  assets: Asset[];

  @OneToMany(() => Fiat, (f) => f.priceRule)
  fiats: Fiat[];

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  reference?: Asset;

  @Column()
  priceSource: PriceSource;

  @Column()
  priceAsset: string;

  @Column()
  priceReference: string;

  // check 1
  @Column({ nullable: true })
  check1Source: PriceSource;

  @Column({ nullable: true })
  check1Asset: string;

  @Column({ nullable: true })
  check1Reference: string;

  @Column({ type: 'float', nullable: true })
  check1Limit: number;

  // check 2
  @Column({ nullable: true })
  check2Source: PriceSource;

  @Column({ nullable: true })
  check2Asset: string;

  @Column({ nullable: true })
  check2Reference: string;

  @Column({ type: 'float', nullable: true })
  check2Limit: number;

  // price
  @Column({ type: 'float', nullable: true })
  currentPrice: number;

  @Column({ type: 'integer' })
  priceValiditySeconds: number;

  @Column({ type: 'datetime2', nullable: true })
  priceTimestamp: Date;

  // getters
  get isPriceValid(): boolean {
    return (
      this.currentPrice != null &&
      this.priceTimestamp != null &&
      Util.secondsDiff(this.priceTimestamp, new Date()) <= this.priceValiditySeconds
    );
  }

  get isPriceObsolete(): boolean {
    return Util.hoursDiff(this.priceTimestamp, new Date()) >= 24;
  }

  get price(): Price {
    return Price.create(
      this.priceAsset,
      this.priceReference,
      this.currentPrice,
      this.isPriceValid,
      this.priceTimestamp ?? new Date(0),
    );
  }

  get rule(): Rule {
    return {
      source: this.priceSource,
      asset: this.priceAsset,
      reference: this.priceReference,
    };
  }

  get check1(): Rule {
    return this.check1Source
      ? {
          source: this.check1Source,
          asset: this.check1Asset ?? this.priceAsset,
          reference: this.check1Reference ?? this.priceReference,
          limit: this.check1Limit,
        }
      : undefined;
  }

  get check2(): Rule | undefined {
    return this.check2Source
      ? {
          source: this.check2Source,
          asset: this.check2Asset ?? this.priceAsset,
          reference: this.check2Reference ?? this.priceReference,
          limit: this.check2Limit,
        }
      : undefined;
  }
}
