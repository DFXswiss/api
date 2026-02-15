import { Injectable } from '@nestjs/common';
import { BitcoinBasedFeeService } from '../../bitcoin/services/bitcoin-based-fee.service';
import { FiroService } from './firo.service';

@Injectable()
export class FiroFeeService extends BitcoinBasedFeeService {
  constructor(firoService: FiroService) {
    super(firoService.getDefaultClient());
  }
}
