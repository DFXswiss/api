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
    const search = new URLSearchParams(message.url?.split('?')[1]);
    const id = search.get('id');
    if (!id) throw new BadRequestException('id parameter is required');

    this.addClient(id, client);
  }

  // --- HELPER METHODS --- //
  private addClient(id: string, client: WebSocket) {
    const clientId = Util.createUniqueId('client');

    const clients = this.clients.get(id) ?? new Map();
    clients.set(clientId, client);
    this.clients.set(id, clients);

    client.onclose = () => this.removeClient(id, clientId);
  }

  private removeClient(id: string, clientId: string) {
    const clients = this.clients.get(id);
    clients?.delete(clientId);
    this.clients.set(id, clients);
  }
}
