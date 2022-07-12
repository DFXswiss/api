import { v4 as uuid } from 'uuid';

export abstract class ICommand {
  readonly id: string = uuid();

  constructor(readonly correlationId: string, readonly payload: any) {}
}
