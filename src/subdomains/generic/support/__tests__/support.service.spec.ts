import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScorechainScreening } from 'src/integration/scorechain/entities/scorechain-screening.entity';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { RecallService } from 'src/subdomains/supporting/recall/recall.service';
import { KycService } from '../../kyc/services/kyc.service';
import { Recommendation } from '../../user/models/recommendation/recommendation.entity';
import { RecommendationService } from '../../user/models/recommendation/recommendation.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { ComplianceSearchType, RecommendationGraphEdgeKind } from '../dto/user-data-support.dto';
import { SupportService } from '../support.service';

// --- entity builders --- //

function createUserData(id: number): UserData {
  return Object.assign(new UserData(), {
    id,
    firstname: `first${id}`,
    surname: `last${id}`,
    kycStatus: 'Completed',
    kycLevel: 50,
    tradeApprovalDate: undefined,
  });
}

function createRecommendation(
  id: number,
  recommenderId?: number,
  recommendedId?: number,
  method = 'RefCode',
): Recommendation {
  return Object.assign(new Recommendation(), {
    id,
    method,
    type: 'Invitation',
    isConfirmed: true,
    confirmationDate: new Date('2024-01-01'),
    created: new Date('2024-01-01'),
    recommender: recommenderId ? createUserData(recommenderId) : undefined,
    recommended: recommendedId ? createUserData(recommendedId) : undefined,
  });
}

function createRefUser(id: number, ref: string, usedRef?: string, userDataId?: number): User {
  return Object.assign(new User(), {
    id,
    ref,
    usedRef,
    userData: userDataId ? createUserData(userDataId) : undefined,
  });
}

describe('SupportService', () => {
  let service: SupportService;

  let userService: UserService;
  let recommendationService: RecommendationService;
  let userDataService: UserDataService;
  let bankTxService: BankTxService;
  let kycService: KycService;
  let recallService: RecallService;
  let buyCryptoService: BuyCryptoService;
  let buyFiatService: BuyFiatService;
  let payInService: PayInService;
  let transactionService: TransactionService;
  let scorechainScreeningService: ScorechainScreeningService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SupportService, TestUtil.provideConfig()],
    })
      .useMocker(() => createMock())
      .compile();

    service = module.get(SupportService);
    userService = module.get(UserService);
    recommendationService = module.get(RecommendationService);
    userDataService = module.get(UserDataService);
    bankTxService = module.get(BankTxService);
    kycService = module.get(KycService);
    recallService = module.get(RecallService);
    buyCryptoService = module.get(BuyCryptoService);
    buyFiatService = module.get(BuyFiatService);
    payInService = module.get(PayInService);
    transactionService = module.get(TransactionService);
    scorechainScreeningService = module.get(ScorechainScreeningService);
  });

  // by default a node returns a UserData entity from getUserDataByIds for every requested id
  function mockUserDatasForRequestedIds(): void {
    jest
      .spyOn(userDataService, 'getUserDataByIds')
      .mockImplementation((ids: number[]) => Promise.resolve(ids.map((id) => createUserData(id))));
  }

  // no further degree beyond what is shown -> nothing expandable
  function mockNoExtraDegree(): void {
    jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([]);
    jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([]);
    jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([]);
    jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRecommendationGraphNeighbors', () => {
    it('applies the default skip=0 and take=25 when not provided', async () => {
      const centerId = 100;
      // 30 children -> with the default take=25 the page must hold exactly 25 and report hasMore
      const childIds = Array.from({ length: 30 }, (_, i) => 201 + i);

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue(childIds.map((childId, i) => createRecommendation(1000 + i, centerId, childId)));
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      // call without skip/take -> defaults skip=0, take=25 kick in
      const graph = await service.getRecommendationGraphNeighbors(centerId);

      expect(graph.nodes.filter((n) => n.id !== centerId)).toHaveLength(25);
      expect(graph.hasMore).toBe(true);
      // ref-code recommendations without a coincident ref edge carry no code
      expect(graph.edges.every((e) => e.refCode === undefined)).toBe(true);
    });

    it('always includes the upward referrers (sorted, ahead of children) even when many downward children exist', async () => {
      const centerId = 100;
      const referrerRecId = 9; // upward via recommendation (unsorted on purpose)
      const referrerRefId = 4; // upward via classic ref-code
      const childIds = [201, 202, 203, 204, 205]; // downward

      // center recommends children (downward) and is recommended by referrerRecId (upward)
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue(childIds.map((childId, i) => createRecommendation(1000 + i, centerId, childId)));
      jest
        .spyOn(recommendationService, 'getRecommendationsByRecommendedId')
        .mockResolvedValue([createRecommendation(2000, referrerRecId, centerId)]);
      // center's own user used referrerRef's code -> second upward referrer
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', 'REF-RER')]);
      jest
        .spyOn(userService, 'getRefUsersByRefs')
        .mockResolvedValue([createRefUser(2, 'REF-RER', undefined, referrerRefId)]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      // take only 3 -> both upward referrers + 1 child on the first page (referrers first, sorted asc)
      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 3);

      const neighborIds = graph.nodes.map((n) => n.id).filter((id) => id !== centerId);
      expect(graph.nodes.map((n) => n.id)).toContain(centerId);
      // exact ordered first-page slice: upward referrers (sorted asc) ahead of the first (sorted) downward child
      // upward {referrerRecId=9, referrerRefId=4} -> sorted [4, 9], then first child 201 -> [4, 9, 201]
      expect(neighborIds).toEqual([referrerRefId, referrerRecId, childIds[0]]);
      expect(graph.hasMore).toBe(true);
      expect(graph.rootId).toBe(centerId);
    });

    it('paginates downward neighbors via skip/take and sets hasMore=false on the last page', async () => {
      const centerId = 100;
      const childIds = [201, 202, 203];

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue(childIds.map((childId, i) => createRecommendation(1000 + i, centerId, childId)));
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const page2 = await service.getRecommendationGraphNeighbors(centerId, 2, 2);

      const neighborIds = page2.nodes.map((n) => n.id).filter((id) => id !== centerId);
      expect(neighborIds).toEqual([203]); // last neighbor only
      expect(page2.hasMore).toBe(false);
    });

    it('dedups a pair that is both a recommendation and a ref-code into a single Recommendation edge', async () => {
      const centerId = 100;
      const childId = 201;

      // recommendation edge center -> child
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, childId)]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);

      // same directed pair also expressed via ref-code: center's own ref used by child
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', undefined)]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([createRefUser(2, 'CHI-LD', 'CEN-TER', childId)]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const edgesForPair = graph.edges.filter((e) => e.recommenderId === centerId && e.recommendedId === childId);
      expect(edgesForPair).toHaveLength(1);
      expect(edgesForPair[0].kind).toBe(RecommendationGraphEdgeKind.RECOMMENDATION);
      // the actual ref code used (the child's usedRef) is carried onto the recommendation edge that
      // supersedes the standalone ref-code edge, so the graph can label it with the code that was used
      expect(edgesForPair[0].refCode).toBe('CEN-TER');
    });

    it('does not surface the coincident backfilled ref code on a non-ref-code recommendation', async () => {
      const centerId = 100;
      const childId = 201;

      // confirmed Mail recommendation center -> child (method !== RefCode)
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, childId, 'Mail')]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);

      // setRecommenderRefCode backfilled the child's usedRef with center's own ref -> coincident ref edge
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', undefined)]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([createRefUser(2, 'CHI-LD', 'CEN-TER', childId)]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      // the ref edge is still superseded by the recommendation (exactly one edge for the pair)
      const edgesForPair = graph.edges.filter((e) => e.recommenderId === centerId && e.recommendedId === childId);
      expect(edgesForPair).toHaveLength(1);
      expect(edgesForPair[0].kind).toBe(RecommendationGraphEdgeKind.RECOMMENDATION);
      // but the backfilled code is not a code the user typed -> not surfaced on a non-ref-code recommendation
      expect(edgesForPair[0].refCode).toBeUndefined();
    });

    it('excludes a self-loop from neighbor traversal (no self neighbor node, no self-loop edge of any kind)', async () => {
      const centerId = 100;

      // a self recommendation contributes no neighbor; a self ref-code contributes neither neighbor nor edge
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, centerId)]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', 'CEN-TER')]);
      // both lookups would resolve back to the center -> collectHop drops them as self ref-edges
      jest
        .spyOn(userService, 'getRefUsersByRefs')
        .mockResolvedValue([createRefUser(1, 'CEN-TER', undefined, centerId)]);
      jest
        .spyOn(userService, 'getUsersByUsedRefs')
        .mockResolvedValue([createRefUser(1, 'CEN-TER', 'CEN-TER', centerId)]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      // no neighbor was added: only the center remains as a node
      expect(graph.nodes.map((n) => n.id)).toEqual([centerId]);
      // self ref-code edge is dropped by collectHop; the self recommendation edge is dropped by buildGraphPayload
      // (recommender.id === recommended.id) -> no self-loop edge of any kind is emitted
      expect(graph.edges).toHaveLength(0);
    });

    it('excludes ref-code links using the default ref (000-000)', async () => {
      const centerId = 100;

      jest.spyOn(recommendationService, 'getAllRecommendationsByRecommenderId').mockResolvedValue([]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      // center's user has usedRef === defaultRef -> must be filtered out before the lookup
      jest
        .spyOn(userService, 'getAllUserDataUsers')
        .mockResolvedValue([createRefUser(1, 'CEN-TER', Config.defaultRef)]);
      const refUsersSpy = jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      expect(refUsersSpy).toHaveBeenCalledWith([]); // defaultRef stripped from the usedRef list
      expect(graph.nodes.map((n) => n.id)).toEqual([centerId]);
      expect(graph.edges).toHaveLength(0);
    });

    it('returns just the center node when there are no neighbors', async () => {
      const centerId = 100;

      jest.spyOn(recommendationService, 'getAllRecommendationsByRecommenderId').mockResolvedValue([]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      // setNodeExpandability must early-return when there are no neighbor ids
      const countSpy = jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([]);
      jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      expect(graph.nodes.map((n) => n.id)).toEqual([centerId]);
      expect(graph.edges).toHaveLength(0);
      expect(graph.hasMore).toBe(false);
      expect(countSpy).not.toHaveBeenCalled(); // no neighbors -> degree counting skipped
    });

    it('marks a neighbor expandable=true when it has external neighbors, false otherwise', async () => {
      const centerId = 100;
      const richChildId = 201; // has further hidden (external) neighbors
      const leafChildId = 202; // only linked to nodes already shown -> external degree 0
      const noCountChildId = 203; // missing from all count mocks -> external degree falls back to 0

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([
          createRecommendation(1000, centerId, richChildId),
          createRecommendation(1001, centerId, leafChildId),
          createRecommendation(1002, centerId, noCountChildId),
        ]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();

      // counts are EXTERNAL (counterparts not in the shown fragment, via excludeIds):
      // richChild has 5 external recommended + 1 external recommender -> expandable
      // leafChild / noCountChild have zero external counterparts -> not expandable
      jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([{ id: richChildId, count: 5 }]);
      jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([{ id: richChildId, count: 1 }]);
      jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const richNode = graph.nodes.find((n) => n.id === richChildId);
      const leafNode = graph.nodes.find((n) => n.id === leafChildId);
      const noCountNode = graph.nodes.find((n) => n.id === noCountChildId);
      const centerNode = graph.nodes.find((n) => n.id === centerId);

      expect(richNode!.expandable).toBe(true);
      expect(leafNode!.expandable).toBe(false); // external degree 0
      expect(noCountNode!.expandable).toBe(false); // externalDegree.get(...) ?? 0 = 0
      expect(centerNode!.expandable).toBe(false); // center is never expandable

      // the shown fragment node ids are passed as excludeIds to every count helper
      const expectedExcludeIds = graph.nodes.map((n) => n.id);
      expect(recommendationService.countByRecommenderIds).toHaveBeenCalledWith(expect.anything(), expectedExcludeIds);
    });

    it('marks a node expandable when it has external neighbors beyond the fragment', async () => {
      const centerId = 100;
      const childId = 201; // connected to center via a recommendation (shown edge)
      const orphanId = 777; // present as a node but has no edge in the fragment

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, childId)]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      // node loader returns an extra orphan node not referenced by any edge
      jest
        .spyOn(userDataService, 'getUserDataByIds')
        .mockImplementation((ids: number[]) =>
          Promise.resolve([...ids.map((id) => createUserData(id)), createUserData(orphanId)]),
        );

      // orphan has 3 external neighbors -> 3 > 0 -> expandable
      jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([{ id: orphanId, count: 3 }]);
      jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const orphanNode = graph.nodes.find((n) => n.id === orphanId);
      expect(orphanNode!.expandable).toBe(true);
    });

    it('marks a node expandable via the ref-code degree branch alone (recommendation counts empty)', async () => {
      const centerId = 100;
      const childId = 201; // linked to center via a recommendation, but its only external degree is ref-code based

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, childId)]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();

      // both recommendation count helpers return [], only a ref-code helper reports external degree -> the
      // summation must still flag the node expandable (covers the ref-degree branch in isolation)
      jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([]);
      jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([{ id: childId, count: 2 }]);
      jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const childNode = graph.nodes.find((n) => n.id === childId);
      expect(childNode!.expandable).toBe(true);
    });

    it('keeps a leaf non-expandable when its only link (both a recommendation AND a ref-code to center) has no external counterpart', async () => {
      const centerId = 100;
      const childId = 201; // leaf: linked to center via BOTH a confirmed recommendation and a ref-code, nothing else

      // recommendation edge center -> child
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, childId)]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      // same directed pair also expressed via ref-code: center's own ref used by child
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', undefined)]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([createRefUser(2, 'CHI-LD', 'CEN-TER', childId)]);

      mockUserDatasForRequestedIds();

      // with excludeIds containing both center and child, the child has NO external counterpart in any of the
      // four count helpers (the old code summed the recommendation count + the ref-code count and compared to
      // the shown degree, double-counting the single pair -> false-positive expandable on this leaf)
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const childNode = graph.nodes.find((n) => n.id === childId);
      expect(childNode!.expandable).toBe(false);
    });

    it('emits negative synthetic ids for pure ref-code (UsedRef) edges', async () => {
      const centerId = 100;
      const referrerId = 5;
      const referredId = 201;

      jest.spyOn(recommendationService, 'getAllRecommendationsByRecommenderId').mockResolvedValue([]);
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      // center's own user uses referrer's ref (upward), and a child uses center's ref (downward)
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', 'REF-RER')]);
      jest
        .spyOn(userService, 'getRefUsersByRefs')
        .mockResolvedValue([createRefUser(2, 'REF-RER', undefined, referrerId)]);
      jest
        .spyOn(userService, 'getUsersByUsedRefs')
        .mockResolvedValue([createRefUser(3, 'CHI-LD', 'CEN-TER', referredId)]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const refEdges = graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.USED_REF);
      expect(refEdges.length).toBeGreaterThanOrEqual(1);
      for (const edge of refEdges) expect(edge.id).toBeLessThan(0);
      // distinct synthetic ids per ref edge
      const ids = refEdges.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps USED_REF edge ids negative and stable per directed pair across separate invocations', async () => {
      const centerId = 100;
      const referrerId = 5;
      const referredId = 201;

      // build the identical single-hop neighborhood twice (as a lazy-expand would re-surface the same edges)
      const setupMocks = () => {
        jest.spyOn(recommendationService, 'getAllRecommendationsByRecommenderId').mockResolvedValue([]);
        jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
        jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([createRefUser(1, 'CEN-TER', 'REF-RER')]);
        jest
          .spyOn(userService, 'getRefUsersByRefs')
          .mockResolvedValue([createRefUser(2, 'REF-RER', undefined, referrerId)]);
        jest
          .spyOn(userService, 'getUsersByUsedRefs')
          .mockResolvedValue([createRefUser(3, 'CHI-LD', 'CEN-TER', referredId)]);
        mockUserDatasForRequestedIds();
        mockNoExtraDegree();
      };

      // map each directed (referrer -> referred) pair to its synthetic edge id
      const refEdgeMap = (graph: Awaited<ReturnType<typeof service.getRecommendationGraphNeighbors>>) =>
        new Map(
          graph.edges
            .filter((e) => e.kind === RecommendationGraphEdgeKind.USED_REF)
            .map((e) => [`${e.recommenderId}-${e.recommendedId}`, e.id] as const),
        );

      setupMocks();
      const first = refEdgeMap(await service.getRecommendationGraphNeighbors(centerId, 0, 25));
      setupMocks();
      const second = refEdgeMap(await service.getRecommendationGraphNeighbors(centerId, 0, 25));

      // two distinct ref edges (upward referrer -> center, downward center -> child)
      expect(first.size).toBe(2);

      // every synthetic id is negative (never collides with positive recommendation row ids)
      for (const id of first.values()) expect(id).toBeLessThan(0);

      // the same directed pair yields an identical id across the two separate invocations (fragment-independent)
      expect(second).toEqual(first);
      const upKey = `${referrerId}-${centerId}`;
      const downKey = `${centerId}-${referredId}`;
      expect(first.get(upKey)).toBeDefined();
      expect(first.get(downKey)).toBeDefined();
      expect(second.get(upKey)).toBe(first.get(upKey));
      expect(second.get(downKey)).toBe(first.get(downKey));

      // distinct directed pairs are not required to collide
      expect(first.get(upKey)).not.toBe(first.get(downKey));
    });

    it('treats a node that is both upward and downward (cycle) as upward only', async () => {
      const centerId = 100;
      const cycleId = 5;

      // cycleId both recommends center (upward) and is recommended by center (downward)
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue([createRecommendation(1000, centerId, cycleId)]);
      jest
        .spyOn(recommendationService, 'getRecommendationsByRecommendedId')
        .mockResolvedValue([createRecommendation(2000, cycleId, centerId)]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      // take 1 -> the single ordered neighbor must be the cycle node (kept as upward, not duplicated)
      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 1);

      const neighborIds = graph.nodes.map((n) => n.id).filter((id) => id !== centerId);
      expect(neighborIds).toEqual([cycleId]);
      expect(graph.hasMore).toBe(false);
    });
  });

  describe('buildGraphPayload edge filter (via neighbors pagination)', () => {
    it('drops a recommendation edge whose far endpoint is paginated out of the visited set', async () => {
      const centerId = 100;
      const childIds = [201, 202, 203];

      // three downward recommendations; only the first child fits on the page
      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockResolvedValue(childIds.map((childId, i) => createRecommendation(1000 + i, centerId, childId)));
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();
      mockNoExtraDegree();

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 1);

      // only center + first child are in the node set
      expect(graph.nodes.map((n) => n.id).sort((a, b) => a - b)).toEqual([centerId, 201]);
      // edges to 202 / 203 are dropped because those endpoints are not in visitedUsers
      const recEdges = graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.RECOMMENDATION);
      expect(recEdges).toHaveLength(1);
      expect(recEdges[0].recommendedId).toBe(201);
    });
  });

  describe('searchUserDataByKey', () => {
    it('looks up user data by id for a numeric key within the integer range', async () => {
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(createUserData(123));
      jest.spyOn(kycService, 'getDfxApprovalSteps').mockResolvedValue([]);
      jest.spyOn(recallService, 'getByBankTxIds').mockResolvedValue([]);

      const result = await service.searchUserDataByKey({ key: '123' });

      expect(userDataService.getUserData).toHaveBeenCalledWith(123);
      expect(result.type).toBe(ComplianceSearchType.USER_DATA_ID);
      expect(result.userDatas.map((u) => u.id)).toEqual([123]);
    });

    it('never queries by id for a numeric key above the integer range', async () => {
      jest.spyOn(buyCryptoService, 'getBuyCryptoByKeys').mockResolvedValue(undefined);
      jest.spyOn(buyFiatService, 'getBuyFiatByKey').mockResolvedValue(undefined);
      jest.spyOn(payInService, 'getCryptoInputByKeys').mockResolvedValue(undefined);
      jest.spyOn(userDataService, 'getUsersByName').mockResolvedValue([]);
      jest.spyOn(bankTxService, 'getBankTxsByName').mockResolvedValue([]);

      await expect(service.searchUserDataByKey({ key: '99999999999' })).rejects.toBeInstanceOf(NotFoundException);

      expect(userDataService.getUserData).not.toHaveBeenCalled();
    });
  });

  describe('getScorechainScreenings', () => {
    const userDataId = 500;

    // BuyCrypto withdrawal: fiat-funded (no cryptoInput) -> screens the target address on the output chain.
    // targetAddress falls back to this.transaction.user.address, so the tx's user must be wired.
    function withdrawalBuyCryptoTx(
      txId: number,
      buyCryptoId: number,
      address: string,
      blockchain: Blockchain,
    ): Transaction {
      const tx = Object.assign(new Transaction(), { id: txId, created: new Date('2024-03-01') });
      tx.user = Object.assign(new User(), { address });
      tx.buyCrypto = Object.assign(new BuyCrypto(), { id: buyCryptoId, outputAsset: { blockchain }, transaction: tx });
      return tx;
    }

    // BuyCrypto swap/deposit: crypto-in -> screens the incoming tx hash on the input asset chain.
    function depositBuyCryptoTx(
      txId: number,
      buyCryptoId: number,
      inTxId: string,
      blockchain: Blockchain,
    ): Transaction {
      const tx = Object.assign(new Transaction(), { id: txId, created: new Date('2024-01-01') });
      tx.buyCrypto = Object.assign(new BuyCrypto(), {
        id: buyCryptoId,
        cryptoInput: { asset: { blockchain }, inTxId },
        transaction: tx,
      });
      return tx;
    }

    // BuyFiat: crypto-in -> screens the incoming deposit tx hash on the input asset chain.
    function buyFiatTx(txId: number, buyFiatId: number, inTxId: string, blockchain: Blockchain): Transaction {
      const tx = Object.assign(new Transaction(), { id: txId, created: new Date('2024-02-01') });
      tx.buyFiat = Object.assign(new BuyFiat(), {
        id: buyFiatId,
        cryptoInput: { asset: { blockchain }, inTxId },
        transaction: tx,
      });
      return tx;
    }

    function screening(id: number, blockchain: Blockchain, objectId: string, created: Date): ScorechainScreening {
      return Object.assign(new ScorechainScreening(), { id, blockchain, objectId, created, signatureValid: true });
    }

    it('derives per-tx keys, skips unsupported chains & cross-chain collisions, annotates related ids, orders DESC', async () => {
      const withdrawalAddress = '0xWithdrawAddr';
      const depositTxHash = 'deposit-tx-hash';
      const fiatTxHash = 'fiat-tx-hash';

      jest.spyOn(transactionService, 'getAllTransactionsForUserData').mockResolvedValue([
        withdrawalBuyCryptoTx(1, 11, withdrawalAddress, Blockchain.ETHEREUM),
        depositBuyCryptoTx(2, 12, depositTxHash, Blockchain.BITCOIN),
        buyFiatTx(3, 21, fiatTxHash, Blockchain.ETHEREUM),
        // unsupported chain (Lightning) -> derivation skipped, its objectId never queried
        buyFiatTx(4, 22, 'ln-tx-hash', Blockchain.LIGHTNING),
      ]);

      const getByObjectIdsSpy = jest.spyOn(scorechainScreeningService, 'getByObjectIds').mockResolvedValue([
        screening(101, Blockchain.ETHEREUM, withdrawalAddress, new Date('2024-03-01')),
        screening(102, Blockchain.BITCOIN, depositTxHash, new Date('2024-01-01')),
        screening(103, Blockchain.ETHEREUM, fiatTxHash, new Date('2024-02-01')),
        // objectId matches the Bitcoin deposit hash but on the wrong chain -> dropped by the (blockchain, objectId) key
        screening(104, Blockchain.ETHEREUM, depositTxHash, new Date('2024-04-01')),
      ]);

      jest.spyOn(scorechainScreeningService, 'isHighRisk').mockImplementation((s) => s.objectId === withdrawalAddress);

      const result = await service.getScorechainScreenings(userDataId);

      // the unsupported-chain objectId is never sent to the screening lookup
      const queriedObjectIds = getByObjectIdsSpy.mock.calls[0][0];
      expect(queriedObjectIds).toEqual(expect.arrayContaining([withdrawalAddress, depositTxHash, fiatTxHash]));
      expect(queriedObjectIds).not.toContain('ln-tx-hash');

      // collision row (104, newest) dropped; three kept, newest first
      expect(result.map((r) => r.id)).toEqual([101, 103, 102]);

      const byObjectId = new Map(result.map((r) => [r.objectId, r]));
      expect(byObjectId.get(withdrawalAddress)!.blockchain).toBe(Blockchain.ETHEREUM);
      expect(byObjectId.get(withdrawalAddress)!.relatedBuyCryptoIds).toEqual([11]);
      expect(byObjectId.get(withdrawalAddress)!.relatedBuyFiatIds).toBeUndefined();
      expect(byObjectId.get(withdrawalAddress)!.isHighRisk).toBe(true);

      expect(byObjectId.get(depositTxHash)!.relatedBuyCryptoIds).toEqual([12]);
      expect(byObjectId.get(depositTxHash)!.isHighRisk).toBe(false);

      expect(byObjectId.get(fiatTxHash)!.relatedBuyFiatIds).toEqual([21]);
      expect(byObjectId.get(fiatTxHash)!.relatedBuyCryptoIds).toBeUndefined();
    });

    it('returns [] and never queries screenings when no tx yields a supported screening object', async () => {
      const getByObjectIdsSpy = jest.spyOn(scorechainScreeningService, 'getByObjectIds').mockResolvedValue([]);
      jest
        .spyOn(transactionService, 'getAllTransactionsForUserData')
        .mockResolvedValue([buyFiatTx(4, 22, 'ln-tx-hash', Blockchain.LIGHTNING)]);

      const result = await service.getScorechainScreenings(userDataId);

      expect(result).toEqual([]);
      expect(getByObjectIdsSpy).not.toHaveBeenCalled();
    });
  });
});
