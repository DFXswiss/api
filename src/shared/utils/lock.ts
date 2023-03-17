class LockClass {
  private lockedSince?: number;

  static create(timeoutSeconds = Infinity): (name: string, task: () => Promise<void>) => Promise<void> {
    const lockObj = new LockClass(timeoutSeconds);
    return (n, t) => lockObj.lock(n, t);
  }

  constructor(private readonly timeoutSeconds: number = Infinity) {}

  private async lock(name: string | null, task: () => Promise<void>): Promise<void> {
    if (!this.acquire()) return;

    try {
      await task();
    } catch (e) {
      name && console.error(`Error during ${name}:`, e);
    } finally {
      this.release();
    }
  }

  private acquire(): boolean {
    if (this.lockedSince && Date.now() - this.lockedSince < this.timeoutSeconds * 1000) return false;

    this.lockedSince = Date.now();
    return true;
  }

  private release(): void {
    this.lockedSince = undefined;
  }
}

export function Lock(timeout?: number, logError = true) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const lock = LockClass.create(timeout);
    const name = `${target.constructor.name}:${propertyKey}`;

    const method = descriptor.value;

    descriptor.value = function (...args: any) {
      return lock(logError ? name : null, () => method.apply(this, args));
    };
  };
}

// for testing only
export const createLock = LockClass.create;
