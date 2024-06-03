import { KycType } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Country extends IEntity {
  @Column({ unique: true, length: 10 })
  symbol: string;

  @Column({ length: 256 })
  name: string;

  @Column({ default: true })
  dfxEnable: boolean;

  @Column({ default: true })
  lockEnable: boolean;

  @Column({ default: true })
  ipEnable: boolean;

  @Column({ default: false })
  maerkiBaumannEnable: boolean;

  @Column({ default: true })
  checkoutEnable: boolean;

  @Column({ default: true })
  fatfEnable: boolean;

  @Column({ default: true })
  nationalityEnable: boolean;

  @Column({ default: false })
  bankTransactionVerificationEnable: boolean;

  isEnabled(kycType: KycType): boolean {
    switch (kycType) {
      case KycType.DFX:
        return this.dfxEnable;

      case KycType.LOCK:
        return this.lockEnable;
    }
  }
}
