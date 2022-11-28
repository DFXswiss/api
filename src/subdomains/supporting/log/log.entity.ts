import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';

export enum LogSeverity {
  INFO = 'Info',
  WARNING = 'Warning',
  ERROR = 'Error',
}

@Entity()
export class Log extends IEntity {
  @Column({ length: 256 })
  system: string;

  @Column({ length: 256 })
  subsystem: string;

  @Column({ length: 256 })
  severity: LogSeverity;

  @Column({ length: 'MAX' })
  message: string;
}
