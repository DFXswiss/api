import { PrimaryGeneratedColumn, UpdateDateColumn, CreateDateColumn } from 'typeorm';

export class IEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;

  static copy<T extends IEntity>(entity: T): T {
    const copy = { ...entity };
    copy.id = undefined;
    copy.updated = undefined;
    copy.created = undefined;

    return copy;
  }
}

export type UpdateResult<T extends IEntity> = [number, Partial<T>];
