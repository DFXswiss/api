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
    let hasRun = false;
    let hasUpdated = false;

    setTimeout(async () => {
      hasRun = true;
      await lock(async () => {
        hasUpdated = true;
      });
    });
    await lock(() => Util.delay(2));

    expect(hasRun).toBeTruthy();
    expect(hasUpdated).toBeFalsy();
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
