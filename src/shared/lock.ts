import { Util } from './util';

export class Lock {
  private lockedSince?: Date;

  constructor(private readonly timeoutSeconds: number = Infinity) {}

  acquire(): boolean {
    if (this.lockedSince && Util.secondsDiff(this.lockedSince, new Date()) < this.timeoutSeconds) return false;

    this.lockedSince = new Date();
    return true;
  }

  release(): void {
    this.lockedSince = undefined;
  }
}
