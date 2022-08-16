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

  create(existingAddress: string, newAddress: string): this {
    this.existingAddress = existingAddress;
    this.newAddress = newAddress;

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    this.expiration = tomorrow;

    return this;
  }

  complete(): this {
    this.isCompleted = true;

    return this;
  }

  isExpired(): boolean {
    return this.expiration.getTime() < new Date().getTime();
  }
}
