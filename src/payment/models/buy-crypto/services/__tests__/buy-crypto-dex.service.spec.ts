import { mock } from 'jest-mock-extended';
import { BehaviorSubject } from 'rxjs';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService } from 'src/ain/node/node.service';
import { createDefaultBuyCryptoBatch } from '../../entities/__tests__/mock/buy-crypto-batch.entity.mock';
import { BuyCryptoBatchRepository } from '../../repositories/buy-crypto-batch.repository';
import { BuyCryptoChainUtil } from '../../utils/buy-crypto-chain.util';
import { BuyCryptoDexService } from '../buy-crypto-dex.service';

describe('BuyCryptoDexService', () => {
  let service: BuyCryptoDexService;

  /*** Dependencies ***/

  let dexClient: NodeClient;
  let buyCryptoBatchRepo: BuyCryptoBatchRepository;
  let buyCryptoChainUtil: BuyCryptoChainUtil;
  let nodeService: NodeService;

  /*** Spies ***/

  let buyCryptoBatchRepoFind: jest.SpyInstance;
  let buyCryptoBatchRepoSave: jest.SpyInstance;
  let buyCryptoChainUtilGetRecentChainHistory: jest.SpyInstance;

  beforeEach(() => {
    setupMocks();
    setupSpies();
  });

  afterEach(() => {
    clearSpies();
  });

  describe('#secureLiquidity(...)', () => {
    it('checks pending batches and secures liquidity in case all are submitted to blockchain', () => {
      console.log('halt');
    });

    it('checks pending batches and ignores those not submitted to blockchain', () => {
      console.log('halt');
    });
  });

  describe('#transferLiquidityForOutput(...)', () => {
    it('', () => {
      console.log('halt');
    });
  });

  // --- HELPER FUNCTIONS --- //

  function setupMocks() {
    dexClient = mock<NodeClient>();
    buyCryptoBatchRepo = mock<BuyCryptoBatchRepository>();
    buyCryptoChainUtil = mock<BuyCryptoChainUtil>();
    nodeService = mock<NodeService>();

    jest.spyOn(nodeService, 'getConnectedNode').mockImplementation(() => new BehaviorSubject(dexClient).asObservable());

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    service = new BuyCryptoDexService(buyCryptoBatchRepo, buyCryptoChainUtil, nodeService);
  }

  function setupSpies() {
    buyCryptoBatchRepoFind = jest.spyOn(buyCryptoBatchRepo, 'find').mockImplementation(async () => [null]);

    buyCryptoBatchRepoSave = jest
      .spyOn(buyCryptoBatchRepo, 'save')
      .mockImplementation(async () => createDefaultBuyCryptoBatch());

    buyCryptoChainUtilGetRecentChainHistory = jest
      .spyOn(buyCryptoChainUtil, 'getRecentChainHistory')
      .mockImplementation(async () => []);
  }

  function clearSpies() {
    buyCryptoBatchRepoFind.mockClear();
    buyCryptoBatchRepoSave.mockClear();
    buyCryptoChainUtilGetRecentChainHistory.mockClear();
  }
});
