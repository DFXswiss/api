import { BadRequestException, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PaymentDevice } from '../entities/payment-link-payment.entity';
import { ConnectedDevice, PaymentLinkPaymentService } from '../services/payment-link-payment.service';

/**
 * The part of an accepted websocket this gateway uses.
 *
 * Named rather than taken wholesale so it is visible what the gateway needs from the socket, and
 * so its behaviour can be exercised without standing up a server.
 */
interface PaymentSocket {
  /**
   * `ws`'s connection state. Read before sending, because `send` is not the place a closing
   * socket reports itself: it throws only while still `CONNECTING`, and on a socket that is
   * `CLOSING` or `CLOSED` it returns quietly and raises the failure through `'error'` — long
   * after the caller decided the command was out. See `sendMessage`.
   */
  readonly readyState: 0 | 1 | 2 | 3;
  send(data: string): void;
  ping(): void;
  terminate(): void;
  on(event: 'close' | 'error' | 'pong', listener: () => void): void;
}

/** `ws.OPEN`. Named rather than imported, so the interface above stays the whole dependency. */
const SOCKET_OPEN = 1;

/** One open websocket, and what is known about it here. */
interface Connection {
  socket: PaymentSocket;
  /** Cleared before each ping and set again by the pong; one missed round means it is gone. */
  responsive: boolean;
}

@WebSocketGateway({ path: '/v1/paymentLink' })
export class PaymentLinkGateway implements OnGatewayConnection, OnModuleInit {
  private readonly clients = new Map<string, Map<string, Connection>>();

  constructor(private readonly paymentService: PaymentLinkPaymentService) {}

  onModuleInit(): void {
    // Handed over rather than subscribed to: the delivery has to know whether the command reached
    // a socket, and that is what `sendMessage` answers. A subscription could not say.
    this.paymentService.useDeviceSink((device) => this.sendMessage(device));

    // The delivery reads what is connected out of the map below instead of being told about it, so
    // there is no second register to keep in step. See PaymentLinkPaymentService.connectedDevices.
    this.paymentService.useDeviceSource(() => this.connectedDevices());
  }

  handleConnection(client: PaymentSocket, message: IncomingMessage): void {
    const device = new URLSearchParams(message.url?.split('?')[1]).get('device');
    if (!device) throw new BadRequestException('device should not be empty');

    this.addClient(device, client);
  }

  /**
   * The devices this process can deliver to right now, derived from the sockets it holds open.
   *
   * A device appears here for exactly as long as at least one of its connections is in the map.
   * When it connected is deliberately not part of it: the delivery selects payments by their own
   * lifetime, so a device that reconnects is owed what it was owed before — for as long as those
   * payments are still inside the read (see DEVICE_DELIVERY_GRACE_SECONDS). A device that stays
   * away past that gets nothing for the payments that aged out meanwhile.
   */
  connectedDevices(): ConnectedDevice[] {
    return [...this.clients.keys()].map((id) => ({ id }));
  }

  /**
   * Drops the connections that stopped answering.
   *
   * A peer that disappears without closing its socket — a network that went away, a device that
   * went to sleep — leaves the socket open on this side, and no close or error event ever arrives.
   * Nothing else in this class can tell such a socket from an idle one, so without this round trip
   * it would stay in the map for as long as the process lives, and the delivery would keep
   * querying for a device that is gone.
   *
   * Deliberately without a `process` flag: switching it off would reinstate exactly the unbounded
   * growth it exists to prevent. It holds no state of its own and does nothing but drop sockets
   * that failed to answer, so there is nothing a kill switch would usefully stop.
   */
  @DfxCron(CronExpression.EVERY_30_SECONDS, { scope: CronScope.BOTH })
  checkConnections(): void {
    for (const [device, connections] of this.clients) {
      for (const [clientId, connection] of connections) {
        if (!connection.responsive) {
          // Dropped from the map BEFORE the socket is terminated. The other way round, a
          // `terminate` that throws left the entry in place and took the exception out of both
          // loops, so every device after this one went unchecked — and the same entry threw first
          // on the next sweep, and on every one after that.
          this.removeClient(device, clientId);
          connection.socket.terminate();

          // And what this process believes it told that device goes with it. This is the third
          // way a command can be lost after the sink answered `true`, and the only one that
          // produces neither a throw nor an `'error'`: the peer stopped answering without closing
          // anything, so a `send` between the last two sweeps went into a socket nobody was
          // reading. An orderly `'close'` is different and deliberately does NOT do this — there
          // the peer completed the closing handshake, which means it was still reading, and
          // forgetting would repeat every command on every reconnect.
          this.paymentService.forgetDeliveries(device);
          continue;
        }

        connection.responsive = false;
        connection.socket.ping();
      }
    }
  }

  // --- HELPER METHODS --- //
  private addClient(device: string, client: PaymentSocket): void {
    const clientId = Util.createUniqueId('client');

    const connections = this.clients.get(device) ?? new Map<string, Connection>();
    connections.set(clientId, { socket: client, responsive: true });
    this.clients.set(device, connections);

    // Bound to the socket, and to every way it can end: an aborted connection reports `error`, and
    // binding to `close` alone left it registered. Removal is idempotent, so both firing is fine.
    client.on('close', () => this.removeClient(device, clientId));
    // `error` does one thing more than `close`: it is how `ws` reports a send on a socket that
    // closed between the delivery's state check and the call itself. The delivery has already
    // recorded that command as sent, so the record has to go — see
    // PaymentLinkPaymentService.forgetDeliveries for why `close` must NOT do the same, and
    // `checkConnections` above for the third case, which reaches neither handler.
    client.on('error', () => {
      this.removeClient(device, clientId);
      this.paymentService.forgetDeliveries(device);
    });
    client.on('pong', () => this.markResponsive(device, clientId));
  }

  private removeClient(device: string, clientId: string): void {
    const connections = this.clients.get(device);
    if (!connections) return;

    connections.delete(clientId);

    // The device goes with its last connection. An empty map left behind would keep the device in
    // `connectedDevices` above, which is the one thing that must not outlive the sockets.
    if (!connections.size) this.clients.delete(device);
  }

  private markResponsive(device: string, clientId: string): void {
    const connection = this.clients.get(device)?.get(clientId);
    if (connection) connection.responsive = true;
  }

  /**
   * Sends to every socket of a device, drops the ones that cannot take it, and reports whether
   * any of them took it.
   *
   * The return value is what the delivery records against: it only marks a command as delivered
   * once one actually left. `false` therefore has to mean "nothing got out" — for a device with
   * no connection here at all, and for one whose sockets could not take it.
   *
   * TWO checks, because `send` alone does not tell the difference. It throws while the socket is
   * still `CONNECTING`, but a socket that is `CLOSING` or `CLOSED` takes the call without a word
   * and reports the failure asynchronously through `'error'` — by which time the caller has
   * already been told the command went out, and the delivery has recorded it against a state it
   * will not send again. So the state is read first, and only an open socket is written to.
   *
   * A socket that fails either way is one the peer is no longer on. Left in the map it would keep
   * the device in `connectedDevices`, so the delivery would go on selecting payments for a device
   * it can no longer reach. Removal is idempotent and the `close`/`error` handlers do the same
   * thing, so a socket that reports both is removed once.
   *
   * One failing socket does not stop the others: a device with two connections is still reachable
   * through the second, and that counts as delivered.
   *
   * What the state check cannot cover: a socket that closes BETWEEN the check and the send. `ws`
   * reports that one asynchronously through `'error'`, so this has already answered `true`.
   *
   * Waiting for the delivery's record to age out does NOT repair that. The record ages on the
   * same cutoff the delivery's query uses, so "the record is gone" and "the payment is still in
   * the read" exclude each other by construction — there is no later tick that would find both.
   * The repair is in the `'error'` handler above, which drops the record so the next tick sends
   * the state again.
   */
  private sendMessage(device: PaymentDevice): boolean {
    const connections = this.clients.get(device.id);
    if (!connections) return false;

    let delivered = false;

    for (const [clientId, { socket }] of [...connections]) {
      if (socket.readyState !== SOCKET_OPEN) {
        this.removeClient(device.id, clientId);
        continue;
      }

      try {
        socket.send(device.command);
        delivered = true;
      } catch {
        this.removeClient(device.id, clientId);
      }
    }

    return delivered;
  }
}
