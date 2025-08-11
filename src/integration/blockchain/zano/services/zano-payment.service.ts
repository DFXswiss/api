import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { ZanoBaseService } from './zano-base.service';

@Injectable()
export class ZanoPaymentService extends ZanoBaseService {
  constructor(readonly moduleRef: ModuleRef, readonly http: HttpService) {
    super(moduleRef, http, Config.blockchain.zano.paymentWallet.url);
  }
}
