import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class WalletApp extends IEntity {
  @Column({ length: 256, unique: true })
  name: string;

  @Column({ length: 256, nullable: true })
  websiteUrl?: string;

  @Column({ length: 256 })
  iconUrl: string;

  @Column({ length: 256, nullable: true })
  deepLink?: string;

  @Column({ nullable: true })
  hasActionDeepLink?: boolean;

  @Column({ length: 'MAX', nullable: true })
  appStoreUrl?: string;

  @Column({ length: 'MAX', nullable: true })
  playStoreUrl?: string;

  @Column({ nullable: true })
  recommended?: boolean;

  @Column({ length: 'MAX', nullable: true })
  blockchains?: string; // semicolon separated blockchains

  @Column({ length: 256, nullable: true })
  assets?: string; // semicolon separated id's

  @Column({ nullable: true })
  semiCompatible?: boolean;

  @Column({ default: true })
  active: boolean;

  // --- ENTITY METHODS --- //

  get supportedAssetList(): number[] {
    return this.assets?.split(';')?.map(Number) ?? [];
  }

  get supportedBlockchainList(): Blockchain[] {
    return [
      ...(this.blockchains?.includes('EvmBlockchains') ? EvmBlockchains : []),
      ...(this.blockchains
        ?.split(';')
        ?.filter((b) => b !== 'EvmBlockchains')
        ?.map((b) => b as Blockchain) ?? []),
    ];
  }
}
