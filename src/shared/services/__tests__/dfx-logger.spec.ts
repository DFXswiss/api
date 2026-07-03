import { Logger } from '@nestjs/common';
import { Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { DfxLogger } from '../dfx-logger';

function fakeSpan(traceId = 'a'.repeat(32), spanId = 'b'.repeat(16)): jest.Mocked<Span> {
  return {
    recordException: jest.fn(),
    addEvent: jest.fn(),
    setStatus: jest.fn(),
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
  } as unknown as jest.Mocked<Span>;
}

describe('DfxLogger', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('without an active span', () => {
    beforeEach(() => jest.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined));

    it('never throws and does not append a trace id', () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const logger = new DfxLogger('Test');
      expect(() => logger.error('boom', new Error('x'))).not.toThrow();
      expect(() => logger.info('hi')).not.toThrow();

      expect(logSpy).toHaveBeenCalledWith('hi');
      expect(errSpy).toHaveBeenCalledWith(expect.not.stringContaining('trace_id='));
    });
  });

  describe('with an active span', () => {
    it('records the exception and marks the span as error on error()', () => {
      const span = fakeSpan();
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const error = new Error('db down');
      new DfxLogger('Test').error('failure', error);

      expect(span.recordException).toHaveBeenCalledWith(error);
      expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'failure' });
    });

    it('adds an event but does not mark an error status on warn()', () => {
      const span = fakeSpan();
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      new DfxLogger('Test').warn('be careful');

      expect(span.addEvent).toHaveBeenCalledWith('be careful');
      expect(span.setStatus).not.toHaveBeenCalled();
    });

    it('appends the trace id to the log line so Loki can link to Tempo', () => {
      const traceId = 'c'.repeat(32);
      const span = fakeSpan(traceId);
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      new DfxLogger('Test').info('processing');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`trace_id=${traceId}`));
    });
  });
});
