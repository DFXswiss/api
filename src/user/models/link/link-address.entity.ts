import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Generated, Index } from 'typeorm';

@Entity()
export class LinkAddress extends IEntity {
  @Column({ length: 256 })
  existingAddress: string;

  @Column({ length: 256 })
  newAddress: string;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  authentication: string;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ type: 'datetime2' })
  expiration: Date;

  static create(existingAddress: string, newAddress: string): LinkAddress {
    const linkAddress = new LinkAddress();
    linkAddress.existingAddress = existingAddress;
    linkAddress.newAddress = newAddress;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    linkAddress.expiration = tomorrow;

    return linkAddress;
  }

  complete(): this {
    this.isCompleted = true;

    return this;
  }

  isExpired(): boolean {
    return this.expiration.getTime() < new Date().getTime();
  }
}
