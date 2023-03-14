import { createLock } from 'src/shared/utils/lock';
import { Util } from '../util';

describe('UserService', () => {
  let lock: (name: string, task: () => Promise<void>) => Promise<void>;

  beforeEach(async () => {
    lock = createLock();
  });

  it('should be defined', () => {
    expect(lock).toBeDefined();
  });

  it('should initially be unlocked', async () => {
    let hasUpdated = false;

    await lock('updater', async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeTruthy();
  });

  it('should lock', async () => {
    let hasRun = false;
    let hasUpdated = false;

    setTimeout(async () => {
      hasRun = true;
      await lock('updater', async () => {
        hasUpdated = true;
      });
    });
    await lock('locker', () => Util.delay(2));

    expect(hasRun).toBeTruthy();
    expect(hasUpdated).toBeFalsy();
  });

  it('should unlock after timeout', async () => {
    lock = createLock(0.0001);

    let hasUpdated = false;

    setTimeout(
      () =>
        lock('updater', async () => {
          hasUpdated = true;
        }),
      1,
    );
    await lock('locker', () => Util.delay(2));

    expect(hasUpdated).toBeTruthy();
  });

  it('should unlock on completion', async () => {
    let hasUpdated = false;

    await lock('locker', () => Util.delay(1));

    await lock('updater', async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeTruthy();
  });

  it('should unlock on error', async () => {
    let hasUpdated = false;

    await lock('locker', () => {
      throw new Error('Test');
    });

    await lock('updater', async () => {
      hasUpdated = true;
    });

    expect(hasUpdated).toBeTruthy();
  });
});
