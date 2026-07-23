import { QueueHandler } from '../queue-handler';

describe('QueueHandler', () => {
  it('runs queued items and returns their results', async () => {
    const queue = new QueueHandler(1000, undefined, 1);

    await expect(queue.handle(async () => 42)).resolves.toBe(42);

    queue.stop();
  });

  it('does not execute items whose queue timeout fired while they were still waiting', async () => {
    const queue = new QueueHandler(100, undefined, 1);
    const ran: number[] = [];

    const first = queue.handle(async () => {
      ran.push(1);
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const second = queue.handle(async () => {
      ran.push(2);
    });

    await expect(first).rejects.toThrow('Queue timeout');
    await expect(second).rejects.toThrow('Queue timeout');

    // let the first action finish and the queue drain — the second must have been discarded
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ran).toEqual([1]);

    queue.stop();
  });

  it('frees the worker slot via item timeout when an action never settles', async () => {
    const queue = new QueueHandler(undefined, 50, 1);

    const hanging = queue.handle(() => new Promise(() => undefined));
    await expect(hanging).rejects.toThrow();

    // slot must be free again: a follow-up item still runs
    await expect(queue.handle(async () => 'ok')).resolves.toBe('ok');

    queue.stop();
  });
});
