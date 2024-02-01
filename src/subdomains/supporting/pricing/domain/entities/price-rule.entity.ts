import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Price } from './price';

export enum PriceSource {
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
}

export interface Rule {
  assetName: string;
  referenceName: string;
  source: PriceSource;
  limit?: number;
}

@Entity()
export class PriceRule extends IEntity {
  @OneToMany(() => Asset, (a) => a.priceRule)
  assets: Asset[];

  @OneToMany(() => Fiat, (f) => f.priceRule)
  fiats: Fiat[];

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  reference: Asset;

  @Column()
  assetName: string;

  @Column()
  referenceName: string;

  @Column()
  source: PriceSource;

  // check 1
  @Column({ nullable: true })
  check1AssetName: string;

  @Column({ nullable: true })
  check1ReferenceName: string;

  @Column({ nullable: true })
  check1Source: PriceSource;

  @Column({ type: 'float', nullable: true })
  check1Limit: number;

  // check 2
  @Column({ nullable: true })
  check2AssetName: string;

  @Column({ nullable: true })
  check2ReferenceName: string;

  @Column({ nullable: true })
  check2Source: PriceSource;

  @Column({ type: 'float', nullable: true })
  check2Limit: number;

  // price
  @Column({ type: 'float', nullable: true })
  currentPrice: number;

  @Column({ type: 'integer' })
  priceValiditySeconds: number;

  // getters
  get isPriceValid(): boolean {
    return this.currentPrice != null && (Date.now() - this.updated.getTime()) / 1000 <= this.priceValiditySeconds;
  }

  get price(): Price {
    return Price.create(this.assetName, this.referenceName, this.currentPrice, this.isPriceValid);
  }

  get check1(): Rule {
    return this.check1Source
      ? {
          assetName: this.check1AssetName ?? this.assetName,
          referenceName: this.check1ReferenceName ?? this.referenceName,
          source: this.check1Source,
          limit: this.check1Limit,
        }
      : undefined;
  }

  get check2(): Rule | undefined {
    return this.check2Source
      ? {
          assetName: this.check2AssetName ?? this.assetName,
          referenceName: this.check2ReferenceName ?? this.referenceName,
          source: this.check2Source,
          limit: this.check2Limit,
        }
      : undefined;
  }
}
