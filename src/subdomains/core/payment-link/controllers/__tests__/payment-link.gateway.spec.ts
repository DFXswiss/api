import { IncomingMessage } from 'http';
import { CronScope, DFX_CRONJOB_PARAMS, DfxCronParams } from 'src/shared/utils/cron';
import { PaymentDevice } from '../../entities/payment-link-payment.entity';
import { PaymentLinkPaymentService } from '../../services/payment-link-payment.service';
import { PaymentLinkGateway } from '../payment-link.gateway';

/**
 * The gateway owns the sockets, so it is the only thing that knows which devices this process can
 * deliver to. Every test here is about that ownership: an entry exists for as long as a socket
 * does, and for no longer — whichever way the socket ends, and whether or not it ends politely.
 */
describe('PaymentLinkGateway', () => {
  let gateway: PaymentLinkGateway;
  let paymentService: jest.Mocked<PaymentLinkPaymentService>;

  /** A socket that records what was done to it and lets a test fire its events. */
  function socket() {
    const listeners = new Map<string, (() => void)[]>();

    return {
      sent: [] as string[],
      pings: 0,
      terminated: false,
      send(data: string) {
        this.sent.push(data);
      },
      ping() {
        this.pings++;
      },
      terminate() {
        this.terminated = true;
      },
      on(event: string, listener: () => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      fire(event: string) {
        for (const listener of listeners.get(event) ?? []) listener();
      },
    };
  }

  /** Accepts a connection the way the adapter does, through the public entry point. */
  function connect(device: string): ReturnType<typeof socket> {
    const client = socket();
    gateway.handleConnection(client, { url: `/v1/paymentLink?device=${device}` } as IncomingMessage);

    return client;
  }

  const deviceIds = () => gateway.connectedDevices().map((d) => d.id);

  /** The sink the gateway registers on init; calling it is what the delivery does. */
  let deliver: (device: PaymentDevice) => boolean;

  beforeEach(() => {
    paymentService = {
      useDeviceSink: jest.fn().mockImplementation((sink) => (deliver = sink)),
      useDeviceSource: jest.fn(),
    } as unknown as jest.Mocked<PaymentLinkPaymentService>;

    gateway = new PaymentLinkGateway(paymentService);
  });

  it('rejects a connection that names no device', () => {
    expect(() => gateway.handleConnection(socket(), { url: '/v1/paymentLink' } as IncomingMessage)).toThrow(
      'device should not be empty',
    );
  });

  describe('what the delivery is allowed to see', () => {
    it('hands the delivery a live view rather than a snapshot', () => {
      // The whole point of deriving instead of mirroring: one function, asked twice, gives two
      // different answers because the sockets changed underneath it. A register the gateway
      // reported into could only be as current as its last report.
      gateway.onModuleInit();

      const source = (paymentService.useDeviceSource as jest.Mock).mock.calls[0][0] as () => { id: string }[];

      expect(source()).toEqual([]);

      const client = connect('pos-1');
      expect(source().map((d) => d.id)).toEqual(['pos-1']);

      client.fire('close');
      expect(source()).toEqual([]);
    });

    it('stops reporting a device once its last connection is gone', () => {
      const client = connect('pos-1');
      expect(deviceIds()).toEqual(['pos-1']);

      client.fire('close');

      expect(deviceIds()).toEqual([]);
    });

    it('keeps reporting a device whose other connection is still open', () => {
      // The failure a reference count had: one close path taken twice pushed the count below the
      // number of live connections, and the device stopped being delivered to while someone was
      // still listening. There is no count to push.
      const first = connect('pos-1');
      const second = connect('pos-1');

      first.fire('close');
      first.fire('close');

      expect(deviceIds()).toEqual(['pos-1']);

      second.fire('close');

      expect(deviceIds()).toEqual([]);
    });

    it('drops a connection that ends with an error instead of a close', () => {
      // An aborted connection does not necessarily reach the close path, which is how an entry
      // came to outlive its socket in the first place.
      const client = connect('pos-1');

      client.fire('error');

      expect(deviceIds()).toEqual([]);
    });

    it('names a device once however many connections it holds, and until the last one goes', () => {
      // The delivery asks for identities, not for dates: what a device is owed follows from the
      // payments themselves. So a second connection adds nothing to say, and closing one of two
      // takes nothing away — the device is still reachable through the other.
      const first = connect('pos-1');
      connect('pos-1');

      expect(gateway.connectedDevices()).toEqual([{ id: 'pos-1' }]);

      first.fire('close');
      expect(gateway.connectedDevices()).toEqual([{ id: 'pos-1' }]);
    });
  });

  describe('sockets that stopped answering', () => {
    it('drops one that misses the ping', () => {
      // Nothing else can see this happen: a peer that vanishes without closing leaves the socket
      // open here and fires no event at all, so an unanswered ping is the only evidence there is.
      const client = connect('pos-1');

      gateway.checkConnections();

      expect(client.pings).toEqual(1);
      expect(deviceIds()).toEqual(['pos-1']);

      gateway.checkConnections();

      expect(client.terminated).toBe(true);
      expect(deviceIds()).toEqual([]);
    });

    it('keeps one that answers the ping', () => {
      // The negative side of the same check. Without it the sweep could pass by dropping every
      // connection it looked at.
      const client = connect('pos-1');

      gateway.checkConnections();
      client.fire('pong');
      gateway.checkConnections();

      expect(client.terminated).toBe(false);
      expect(deviceIds()).toEqual(['pos-1']);
    });

    it('drops the entry even when terminating the socket throws', () => {
      // A socket implementation that throws on terminate used to leave its entry behind, and the
      // exception left both loops. The same entry then threw first on every following sweep, so
      // the map it exists to bound never shrank again and no other device was ever checked.
      const failing = connect('pos-1');
      failing.terminate = () => {
        throw new Error('socket already destroyed');
      };
      const other = connect('pos-2');

      gateway.checkConnections();

      expect(() => gateway.checkConnections()).toThrow('socket already destroyed');
      expect(deviceIds()).toEqual(['pos-2']);

      // The sweep gets past it from here on, which is what makes the failure single-shot.
      gateway.checkConnections();

      expect(other.terminated).toBe(true);
      expect(deviceIds()).toEqual([]);
    });

    it('runs in every process, because every process holds its own sockets', () => {
      const params: DfxCronParams = Reflect.getMetadata(
        DFX_CRONJOB_PARAMS,
        PaymentLinkGateway.prototype.checkConnections,
      );

      expect(params.scope).toEqual(CronScope.BOTH);
    });
  });

  it('sends a command to every connection of the addressed device', () => {
    gateway.onModuleInit();

    const first = connect('pos-1');
    const second = connect('pos-1');
    const other = connect('pos-2');

    expect(deliver({ id: 'pos-1', command: 'show-paid' })).toBe(true);

    expect(first.sent).toEqual(['show-paid']);
    expect(second.sent).toEqual(['show-paid']);
    expect(other.sent).toEqual([]);
  });

  it('reports nothing delivered when the device has no connection here', () => {
    // `false` is what keeps the delivery from recording a command it never sent — a device
    // connected to the OTHER process must stay owed.
    gateway.onModuleInit();

    expect(deliver({ id: 'pos-unknown', command: 'show-paid' })).toBe(false);
  });

  it('reports nothing delivered when every socket of the device throws, and drops them', () => {
    gateway.onModuleInit();

    const client = connect('pos-1');
    client.send = () => {
      throw new Error('socket closed');
    };

    expect(deliver({ id: 'pos-1', command: 'show-paid' })).toBe(false);
    // Dropped, so the device stops being selected for delivery at all.
    expect(deviceIds()).toEqual([]);
  });

  it('reports delivered when one socket takes it and another throws', () => {
    gateway.onModuleInit();

    const broken = connect('pos-1');
    broken.send = () => {
      throw new Error('socket closed');
    };
    const working = connect('pos-1');

    expect(deliver({ id: 'pos-1', command: 'show-paid' })).toBe(true);
    expect(working.sent).toEqual(['show-paid']);
    // The device is still reachable through the one that worked.
    expect(deviceIds()).toEqual(['pos-1']);
  });
});
