import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, OneToMany } from 'typeorm';

export enum UserRole{
  USER = 'User',
  ADMIN = 'Admin',
  EMPLOYEE = 'Employee',
  VIP = 'VIP'
}

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 34, unique: true })
  address: string;

  @Column({ type: 'int' })
  ref: number;

  @Column({ type: 'varchar', unique: true, length: 88 })
  signature: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  mail: string;

  @Column({ type: 'int', default: 0 })
  // @ManyToOne((_type) => )
  walletId: number; //TODO: Objekt Referenzieren

  @Column({ type: 'int', default: 0 })
  usedRef: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  firstname: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  surname: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  street: string;

  @Column({ type: 'varchar', length: 5, default: '' })
  houseNumber: string;

  @Column({ type: 'varchar', length: 64, default: '' })
  location: string;

  @Column({ type: 'varchar', length: 9, default: '' })
  zip: string;

  @Column({ type: 'varchar', length: 3, default: '' })
  country: string;

  @Column({ type: 'varchar', length: 15, default: '' })
  phone: string;

  @Column({ type: 'varchar', default: 'User' })
  role: UserRole;

  @Column({ type: 'varchar', default: 'NA'})
  status: string

  @Column({ type: 'varchar', default: "0.0.0.0"})
  ip: string
}
