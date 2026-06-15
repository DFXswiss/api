import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { RealUnitRegistration } from './realunit-registration.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // ... other columns ...

  @OneToMany(() => RealUnitRegistration, (registration) => registration.user)
  realUnitRegistrations: RealUnitRegistration[];
}