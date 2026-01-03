import { Context, createLock } from 'src/shared/utils/lock';
import { Util } from '../util';

describe('Lock', () => {
  let lock: (task: () => Promise<void>, context?: Context) => Promise<void>;

  beforeEach(async () => {
    lock = createLock();
  });

  it('should be defined', () => {
    expect(lock).toBeDefined();
  });

  it('should initially be unlocked', async () => {
    let hasUpdated = false;

    await lock(async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeTruthy();
  });

  it('should lock', async () => {
    let hasUpdated = false;
    let resolveLockHeld: () => void;
    const lockHeld = new Promise<void>((r) => (resolveLockHeld = r));
    let releaseFirstLock: () => void;
    const waitForRelease = new Promise<void>((r) => (releaseFirstLock = r));

    // Start first lock and signal when acquired
    const firstLockPromise = lock(async () => {
      resolveLockHeld();
      await waitForRelease;
    });

    // Wait until first lock is definitely held
    await lockHeld;

    // Try to acquire second lock while first is held - should be rejected
    await lock(async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeFalsy();

    // Release first lock and wait for completion
    releaseFirstLock();
    await firstLockPromise;
  });

  it('should unlock on completion', async () => {
    let hasUpdated = false;

    await lock(() => Util.delay(1));

    await lock(async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeTruthy();
  });

  it('should unlock on error', async () => {
    let hasUpdated = false;

    await lock(() => {
      throw new Error('Test');
    });

    await lock(async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeTruthy();
  });
});
