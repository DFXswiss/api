import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    PrimaryColumn,
    Index,
  } from 'typeorm';
  import * as typeorm from 'typeorm';
  
  export enum PaymentType {
    BUY = 'Buy',
    SELL = 'Sell'
  }

  @Entity()
  export class Payment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'int'})
    userId: number;

    @Column({ type: 'varchar'})
    type: PaymentType;

    @Column({ type: 'tinyint', default: 0})
    flagged: boolean;

    @Column({ type: 'tinyint', default: 0})
    kycRequired: boolean;

    @Column({ type: 'tinyint', default: 0})
    kycExistent: boolean;
  
    @Column({ type: 'varchar', length: 34 })
    address: string;
  
    @Column({ type: 'varchar', length: 32 })
    iban: string;

    @Column({ type: 'varchar', length: 34, nullable: true })
    depositAddress: string;
  
    @Column({ type: 'int', nullable: true })
    fiat: number;
  
    @Column({ type: 'float', nullable: true })
    fiatValue: number;
  
    @Column({ type: 'int', nullable: true })
    asset: number;
  
    @Column({ type: 'float', nullable: true })
    assetValue: number;
  
    @Column({ type: 'tinyint', default: 0 })
    processed: boolean;
  }