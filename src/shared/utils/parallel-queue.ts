import { QueueHandler } from './queue-handler';

export function ParallelQueue(maxWorker: number) {
  const queue = QueueHandler.createParallelQueueHandler(maxWorker);

  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = function (...args: any[]) {
      return queue.handle(async () => method.apply(this, args));
    };
  };
}
