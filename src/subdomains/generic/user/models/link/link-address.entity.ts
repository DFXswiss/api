import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, Generated, Index } from 'typeorm';

@Entity()
export class LinkAddress extends IEntity {
  @Column({ length: 256 })
  existingAddress: string;

  @Column({ length: 256 })
  existingBlockchain: Blockchain;

  @Column({ length: 256 })
  newAddress: string;

  @Column({ length: 256 })
  newBlockchain: Blockchain;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  authentication: string;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ type: 'datetime2' })
  expiration: Date;

  static create(
    existingAddress: string,
    existingBlockchain: Blockchain,
    newAddress: string,
    newBlockchain: Blockchain,
  ): LinkAddress {
    const linkAddress = new LinkAddress();
    linkAddress.existingAddress = existingAddress;
    linkAddress.existingBlockchain = existingBlockchain;
    linkAddress.newAddress = newAddress;
    linkAddress.newBlockchain = newBlockchain;

    const tomorrow = Util.daysAfter(1);
    linkAddress.expiration = tomorrow;

    return linkAddress;
  }

  complete(): this {
    this.isCompleted = true;

    return this;
  }

  isExpired(): boolean {
    return this.expiration < new Date();
  }
}
