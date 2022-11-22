export class Lock {
  private lockedSince?: number;

  constructor(private readonly timeoutSeconds: number = Infinity) {}

  acquire(): boolean {
    if (this.lockedSince && Date.now() - this.lockedSince < this.timeoutSeconds * 1000) return false;

    this.lockedSince = Date.now();
    return true;
  }

  release(): void {
    this.lockedSince = undefined;
  }
}
