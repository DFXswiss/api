import { BadRequestException } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { Util } from 'src/shared/utils/util';

type ClientMap = Map<string, Map<string, WebSocket>>;

@WebSocketGateway({ path: '/v1/paymentLink' })
export class PaymentLinkGateway implements OnGatewayConnection {
  private readonly idClients: ClientMap = new Map();
  private readonly extIdClients: ClientMap = new Map();

  handleConnection(client: WebSocket, message: IncomingMessage) {
    const search = new URLSearchParams(message.url?.split('?')[1]);
    const id = search.get('id');
    const externalId = search.get('external-id');
    if (!id && !externalId) throw new BadRequestException('id or external-id is required');

    this.addClient(id ?? externalId, id ? this.idClients : this.extIdClients, client);

    setTimeout(() => client.send('12-10000'), 5000);
  }

  // --- HELPER METHODS --- //
  private addClient(id: string, map: ClientMap, client: WebSocket) {
    const clientId = Util.createUniqueId('client');

    const clients = map.get(id) ?? new Map();
    clients.set(clientId, client);
    map.set(id, clients);

    client.onclose = () => this.removeClient(id, clientId, map);
  }

  private removeClient(id: string, clientId: string, map: ClientMap) {
    const clients = map.get(id);
    clients?.delete(clientId);
    map.set(id, clients);
  }
}
