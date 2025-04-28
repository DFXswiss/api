import { Injectable } from '@nestjs/common';
import { PolygonService } from 'src/integration/blockchain/polygon/polygon.service';
import { PayoutEvmService } from './payout-evm.service';

@Injectable()
export class PayoutPolygonService extends PayoutEvmService {
  constructor(polygonService: PolygonService) {
    super(polygonService);
  }
}
