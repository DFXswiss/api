import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { PricingProviderMap } from '../interfaces';
import { Price } from './price';

export enum PriceSource {
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  KUCOIN = 'Kucoin',
  COIN_GECKO = 'CoinGecko',
  DEX = 'DEX',
  FIXER = 'Fixer',
  CURRENCY = 'Currency',
  FRANKENCOIN = 'Frankencoin',
  EBEL2X = 'Ebel2X',
  CONSTANT = 'Constant',
}

export interface Rule {
  source: PriceSource;
  param?: string;
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
  priceSource: string; // {src}:{param}

  @Column()
  priceAsset: string;

  @Column()
  priceReference: string;

  // check 1
  @Column({ nullable: true })
  check1Source: string; // {src}:{param}

  @Column({ nullable: true })
  check1Asset: string;

  @Column({ nullable: true })
  check1Reference: string;

  @Column({ type: 'float', nullable: true })
  check1Limit: number;

  // check 2
  @Column({ nullable: true })
  check2Source: string; // {src}:{param}

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
  get shouldUpdate(): boolean {
    return !this.isPriceValid || Util.secondsDiff(this.priceTimestamp) > this.priceValiditySeconds - 15;
  }

  get isPriceValid(): boolean {
    return (
      this.currentPrice != null &&
      this.priceTimestamp != null &&
      Util.secondsDiff(this.priceTimestamp) <= this.priceValiditySeconds + 15
    );
  }

  get isPriceObsolete(): boolean {
    return Util.hoursDiff(this.priceTimestamp) >= 24;
  }

  getPrice(providers: PricingProviderMap): Price {
    if (!this.currentPrice || !this.priceTimestamp) throw new Error(`No price available for rule ${this.id}`);

    return Price.create(
      this.priceAsset,
      this.priceReference,
      this.currentPrice,
      this.isPriceValid,
      this.priceTimestamp,
      providers[this.rule.source].getPriceStep(this),
    );
  }

  get rule(): Rule {
    return {
      ...this.parseSource(this.priceSource),
      asset: this.priceAsset,
      reference: this.priceReference,
    };
  }

  get check1(): Rule {
    return this.check1Source
      ? {
          ...this.parseSource(this.check1Source),
          asset: this.check1Asset ?? this.priceAsset,
          reference: this.check1Reference ?? this.priceReference,
          limit: this.check1Limit,
        }
      : undefined;
  }

  get check2(): Rule | undefined {
    return this.check2Source
      ? {
          ...this.parseSource(this.check2Source),
          asset: this.check2Asset ?? this.priceAsset,
          reference: this.check2Reference ?? this.priceReference,
          limit: this.check2Limit,
        }
      : undefined;
  }

  private parseSource(priceSource: string): { source: PriceSource; param?: string } {
    const [source, param] = priceSource.split(':');

    return {
      source: source as PriceSource,
      param,
    };
  }
}
