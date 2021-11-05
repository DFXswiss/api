import { Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column, ManyToOne } from 'typeorm';
import { FiatInputBatch } from './fiat-input-batch.entity';

@Entity()
export class FiatInput {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => FiatInputBatch, (batch) => batch.fiatInputs, { nullable: false })
  batch: FiatInputBatch;

  // TODO

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;

  // Robin's generic columns
  @Column({ length: 256, nullable: true })
  field1?: string;

  @Column({ length: 256, nullable: true })
  field2$?: string;

  @Column({ length: 256, nullable: true })
  field3$?: string;

  @Column({ length: 256, nullable: true })
  field4$?: string;

  @Column({ length: 256, nullable: true })
  field5$?: string;

  @Column({ length: 256, nullable: true })
  field6$?: string;

  @Column({ length: 256, nullable: true })
  field7$?: string;

  @Column({ length: 256, nullable: true })
  field8$?: string;

  @Column({ length: 256, nullable: true })
  field9$?: string;

  @Column({ length: 256, nullable: true })
  field1$0?: string;

  @Column({ length: 256, nullable: true })
  field1$1?: string;

  @Column({ length: 256, nullable: true })
  field1$2?: string;

  @Column({ length: 256, nullable: true })
  field1$3?: string;

  @Column({ length: 256, nullable: true })
  field1$4?: string;

  @Column({ length: 256, nullable: true })
  field1$5?: string;

  @Column({ length: 256, nullable: true })
  field1$6?: string;

  @Column({ length: 256, nullable: true })
  field1$7?: string;

  @Column({ length: 256, nullable: true })
  field1$8?: string;

  @Column({ length: 256, nullable: true })
  field1$9?: string;

  @Column({ length: 256, nullable: true })
  field2$0?: string;

  @Column({ length: 256, nullable: true })
  field2$1?: string;

  @Column({ length: 256, nullable: true })
  field2$2?: string;

  @Column({ length: 256, nullable: true })
  field2$3?: string;

  @Column({ length: 256, nullable: true })
  field2$4?: string;

  @Column({ length: 256, nullable: true })
  field2$5?: string;

  @Column({ length: 256, nullable: true })
  field2$6?: string;

  @Column({ length: 256, nullable: true })
  field2$7?: string;

  @Column({ length: 256, nullable: true })
  field2$8?: string;

  @Column({ length: 256, nullable: true })
  field2$9?: string;

  @Column({ length: 256, nullable: true })
  field3$0?: string;
}
