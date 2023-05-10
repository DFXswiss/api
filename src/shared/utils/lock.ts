import { DfxLogger } from '../services/dfx-logger';

export interface Context {
  target: string;
  method: string;
}

class LockClass {
  private lockedSince?: number;

  static create(timeoutSeconds = Infinity): (task: () => Promise<void>, context?: Context) => Promise<void> {
    const lockObj = new LockClass(timeoutSeconds);
    return (t, c) => lockObj.lock(t, c);
  }

  constructor(private readonly timeoutSeconds: number = Infinity) {}

  private async lock(task: () => Promise<void>, context?: Context): Promise<void> {
    if (!this.acquire()) return;

    try {
      await task();
    } catch (e) {
      context && new DfxLogger(context.target).error(`Error during ${context.method}:`, e);
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

    const method = descriptor.value;
    const context = logError ? { target: target.constructor.name, method: propertyKey } : undefined;

    descriptor.value = function (...args: any) {
      return lock(() => method.apply(this, args), context);
    };
  };
}

// for testing only
export const createLock = LockClass.create;
