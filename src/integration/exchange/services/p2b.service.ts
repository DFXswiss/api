// import { Injectable } from '@nestjs/common';
// import { p2b } from 'ccxt';
// import { GetConfig } from 'src/config/config';
// import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
// import { DfxLogger } from 'src/shared/services/dfx-logger';
// import { ExchangeService } from './exchange.service';

// @Injectable()
// export class P2BService extends ExchangeService {
//   protected readonly logger = new DfxLogger(P2BService);

//   protected networks: { [b in Blockchain]: string } = {
//     Arbitrum: undefined,
//     BinanceSmartChain: undefined,
//     Bitcoin: undefined,
//     Lightning: undefined,
//     Monero: undefined,
//     Cardano: undefined,
//     DeFiChain: undefined,
//     Ethereum: undefined,
//     Optimism: undefined,
//     Polygon: undefined,
//     Base: undefined,
//     Haqq: undefined,
//     Liquid: undefined,
//     Arweave: undefined,
//   };

//   constructor() {
//     super(p2b, GetConfig().p2b);
//   }
// }
// TODO: activate
