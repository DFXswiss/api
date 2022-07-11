import { SchedulerRegistry } from '@nestjs/schedule';
import { HttpService } from 'src/shared/services/http.service';
import { NodeClient, NodeMode } from './node-client';

export class BtcClient extends NodeClient {
  constructor(http: HttpService, url: string, scheduler: SchedulerRegistry, mode: NodeMode) {
    super(http, url, scheduler, mode);
  }
}
