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
  send(data: string): void;
  ping(): void;
  terminate(): void;
  on(event: 'close' | 'error' | 'pong', listener: () => void): void;
}

/** One open websocket, and what is known about it here. */
interface Connection {
  socket: PaymentSocket;
  /** When this connection was accepted. */
  since: Date;
  /** Cleared before each ping and set again by the pong; one missed round means it is gone. */
  responsive: boolean;
}

@WebSocketGateway({ path: '/v1/paymentLink' })
export class PaymentLinkGateway implements OnGatewayConnection, OnModuleInit {
  private readonly clients = new Map<string, Map<string, Connection>>();

  constructor(private readonly paymentService: PaymentLinkPaymentService) {}

  onModuleInit() {
    this.paymentService.getDeviceActivationObservable().subscribe((a) => this.sendMessage(a));

    // The delivery reads what is connected out of the map below instead of being told about it, so
    // there is no second register to keep in step. See PaymentLinkPaymentService.connectedDevices.
    this.paymentService.useDeviceSource(() => this.connectedDevices());
  }

  handleConnection(client: PaymentSocket, message: IncomingMessage) {
    const device = new URLSearchParams(message.url?.split('?')[1]).get('device');
    if (!device) throw new BadRequestException('device should not be empty');

    this.addClient(device, client);
  }

  /**
   * The devices this process can deliver to right now, derived from the sockets it holds open.
   *
   * A device appears here for exactly as long as at least one of its connections is in the map,
   * and its `since` is the age of the oldest of those — the point from which a newly connected
   * device has not been sent anything yet.
   */
  connectedDevices(): ConnectedDevice[] {
    return [...this.clients].map(([id, connections]) => ({
      id,
      since: Util.minObj([...connections.values()], 'since').since,
    }));
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
          connection.socket.terminate();
          this.removeClient(device, clientId);
          continue;
        }

        connection.responsive = false;
        connection.socket.ping();
      }
    }
  }

  // --- HELPER METHODS --- //
  private addClient(device: string, client: PaymentSocket) {
    const clientId = Util.createUniqueId('client');

    const connections = this.clients.get(device) ?? new Map<string, Connection>();
    connections.set(clientId, { socket: client, since: new Date(), responsive: true });
    this.clients.set(device, connections);

    // Bound to the socket, and to every way it can end: an aborted connection reports `error`, and
    // binding to `close` alone left it registered. Removal is idempotent, so both firing is fine.
    client.on('close', () => this.removeClient(device, clientId));
    client.on('error', () => this.removeClient(device, clientId));
    client.on('pong', () => this.markResponsive(device, clientId));
  }

  private removeClient(device: string, clientId: string) {
    const connections = this.clients.get(device);
    if (!connections) return;

    connections.delete(clientId);

    // The device goes with its last connection. An empty map left behind would keep the device in
    // `connectedDevices` above, which is the one thing that must not outlive the sockets.
    if (!connections.size) this.clients.delete(device);
  }

  private markResponsive(device: string, clientId: string) {
    const connection = this.clients.get(device)?.get(clientId);
    if (connection) connection.responsive = true;
  }

  private sendMessage(device: PaymentDevice) {
    const connections = this.clients.get(device.id);
    if (!connections) return;

    for (const { socket } of connections.values()) {
      socket.send(device.command);
    }
  }
}
