import { BadRequestException, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { IncomingMessage } from 'http';
import { Util } from 'src/shared/utils/util';
import { PaymentDevice } from '../entities/payment-link-payment.entity';
import { PaymentLinkPaymentService } from '../services/payment-link-payment.service';

type ClientMap = Map<string, Map<string, WebSocket>>;

@WebSocketGateway({ path: '/v1/paymentLink' })
export class PaymentLinkGateway implements OnGatewayConnection, OnModuleInit {
  private readonly clients: ClientMap = new Map();

  constructor(private readonly paymentService: PaymentLinkPaymentService) {}

  onModuleInit() {
    this.paymentService.getDeviceActivationObservable().subscribe((a) => this.sendMessage(a));
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

  private sendMessage(device: PaymentDevice) {
    const clients = this.clients.get(device.id);
    if (!clients) return;

    for (const client of clients.values()) {
      client.send(device.command);
    }
  }
}
