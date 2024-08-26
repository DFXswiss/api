import { BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';

type ClientMap = Map<string, Map<string, WebSocket>>;

@WebSocketGateway({ path: '/v1/paymentLink' })
export class PaymentLinkGateway implements OnGatewayConnection {
  private readonly clients: ClientMap = new Map();

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock()
  sendMessages() {
    for (const devices of this.clients.values()) {
      for (const client of devices.values()) {
        client.send('12-10000');
      }
    }
  }

  handleConnection(client: WebSocket, message: IncomingMessage) {
    const device = new URLSearchParams(message.url?.split('?')[1]).get('device');
    if (!device) throw new BadRequestException('device should not be empty');

    this.addClient(device, client);
  }

  // --- HELPER METHODS --- //
  private addClient(device: string, client: WebSocket) {
    const clientId = Util.createUniqueId('client');

    const clients = this.clients.get(device) ?? new Map();
    clients.set(clientId, client);
    this.clients.set(device, clients);

    client.onclose = () => this.removeClient(device, clientId);
  }

  private removeClient(device: string, clientId: string) {
    const clients = this.clients.get(device);
    clients?.delete(clientId);
    this.clients.set(device, clients);
  }
}
