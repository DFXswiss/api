import { Injectable } from '@nestjs/common';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { PayInEvmService } from './base/payin-evm.service';

@Injectable()
export class PayInPolygonService extends PayInEvmService {
  constructor(polygonService: PolygonService) {
    super(polygonService);
  }
}
