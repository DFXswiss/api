import { createMock } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { TestUtil } from 'src/shared/utils/test.util';
import { Recommendation } from '../../user/models/recommendation/recommendation.entity';
import { RecommendationService } from '../../user/models/recommendation/recommendation.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { RecommendationGraphEdgeKind } from '../dto/user-data-support.dto';
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

function createRecommendation(id: number, recommenderId?: number, recommendedId?: number): Recommendation {
  return Object.assign(new Recommendation(), {
    id,
    method: 'RefCode',
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
      // both upward referrers present and ordered ahead of any downward child
      expect(neighborIds).toContain(referrerRefId);
      expect(neighborIds).toContain(referrerRecId);
      expect(neighborIds.slice(0, 2).sort((a, b) => a - b)).toEqual([referrerRefId, referrerRecId]);
      expect(neighborIds).toHaveLength(3); // 2 upward + 1 child
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
    });

    it('excludes a self-loop from neighbor traversal (no self neighbor node, no self ref-code edge)', async () => {
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
      // self ref-code edge is dropped; only the self recommendation edge survives (both endpoints == center)
      expect(graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.USED_REF)).toHaveLength(0);
      const selfRecEdges = graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.RECOMMENDATION);
      expect(selfRecEdges).toHaveLength(1);
      expect(selfRecEdges[0].recommenderId).toBe(centerId);
      expect(selfRecEdges[0].recommendedId).toBe(centerId);
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

    it('marks a neighbor expandable=true when its real degree exceeds the shown degree, false otherwise', async () => {
      const centerId = 100;
      const richChildId = 201; // has further hidden neighbors
      const leafChildId = 202; // fully shown (degree == shown)
      const noCountChildId = 203; // missing from all count mocks -> degree falls back to 0

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

      // richChild total degree 5 as recommender + 1 as recommended (shown only 1) -> expandable
      // leafChild degree 1 (== shown) -> not expandable
      // noCountChild absent from every count list -> degree falls back to 0 (?? 0) -> not expandable
      jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([{ id: richChildId, count: 5 }]);
      jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([
        { id: richChildId, count: 1 },
        { id: leafChildId, count: 1 },
      ]);
      jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const richNode = graph.nodes.find((n) => n.id === richChildId);
      const leafNode = graph.nodes.find((n) => n.id === leafChildId);
      const noCountNode = graph.nodes.find((n) => n.id === noCountChildId);
      const centerNode = graph.nodes.find((n) => n.id === centerId);

      expect(richNode.expandable).toBe(true);
      expect(leafNode.expandable).toBe(false);
      expect(noCountNode.expandable).toBe(false); // degree.get(...) ?? 0 = 0
      expect(centerNode.expandable).toBe(false); // center is never expandable
    });

    it('treats a node with degree but no shown edge as expandable (shownDegree falls back to 0)', async () => {
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

      // orphan has real degree 3 but zero shown edges -> 3 > 0 -> expandable
      jest.spyOn(recommendationService, 'countByRecommenderIds').mockResolvedValue([{ id: orphanId, count: 3 }]);
      jest.spyOn(recommendationService, 'countByRecommendedIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefChildrenByUserDataIds').mockResolvedValue([]);
      jest.spyOn(userService, 'countRefReferrersByUserDataIds').mockResolvedValue([]);

      const graph = await service.getRecommendationGraphNeighbors(centerId, 0, 25);

      const orphanNode = graph.nodes.find((n) => n.id === orphanId);
      expect(orphanNode.expandable).toBe(true); // shownDegree.get(orphan) ?? 0 = 0
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

  describe('getRecommendationGraph (BFS)', () => {
    it('traverses multiple hops + ref-code links and dedups a diamond where a node is reachable twice', async () => {
      // diamond: root -> a, root -> b, a -> sink, b -> sink (sink enqueued twice, must be visited once)
      const rootId = 1;
      const aId = 2;
      const bId = 3;
      const sinkId = 4;
      const refChildId = 5; // reached via classic ref-code from the root

      const recsByRecommender = new Map<number, Recommendation[]>([
        [rootId, [createRecommendation(10, rootId, aId), createRecommendation(11, rootId, bId)]],
        [aId, [createRecommendation(12, aId, sinkId)]],
        [bId, [createRecommendation(13, bId, sinkId)]],
      ]);
      const recsByRecommended = new Map<number, Recommendation[]>([
        [aId, [createRecommendation(10, rootId, aId)]],
        [bId, [createRecommendation(11, rootId, bId)]],
        [sinkId, [createRecommendation(12, aId, sinkId), createRecommendation(13, bId, sinkId)]],
      ]);

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockImplementation((id: number) => Promise.resolve(recsByRecommender.get(id) ?? []));
      jest
        .spyOn(recommendationService, 'getRecommendationsByRecommendedId')
        .mockImplementation((id: number) => Promise.resolve(recsByRecommended.get(id) ?? []));

      // only the root has a ref-code child (downward via classic ref-code)
      jest
        .spyOn(userService, 'getAllUserDataUsers')
        .mockImplementation((id: number) =>
          Promise.resolve(id === rootId ? [createRefUser(900, 'ROO-T', undefined)] : []),
        );
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest
        .spyOn(userService, 'getUsersByUsedRefs')
        .mockImplementation((refs: string[]) =>
          Promise.resolve(refs.includes('ROO-T') ? [createRefUser(901, 'CHI-LD', 'ROO-T', refChildId)] : []),
        );

      mockUserDatasForRequestedIds();

      const graph = await service.getRecommendationGraph(rootId);

      // every reachable node visited exactly once (sink deduped despite two inbound paths)
      expect(graph.nodes.map((n) => n.id).sort((a, b) => a - b)).toEqual([rootId, aId, bId, sinkId, refChildId]);
      // four recommendation edges (deduped by rec id) + one ref-code edge
      const recEdges = graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.RECOMMENDATION);
      expect(recEdges.map((e) => e.id).sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
      const refEdges = graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.USED_REF);
      expect(refEdges).toHaveLength(1);
      expect(refEdges[0].recommenderId).toBe(rootId);
      expect(refEdges[0].recommendedId).toBe(refChildId);
      expect(graph.rootId).toBe(rootId);
      expect(graph.hasMore).toBeUndefined(); // full graph has no pagination flag
    });

    it('keeps an edge only when both endpoints are within the visited set (BFS hop cap behaviour)', async () => {
      const rootId = 1;
      const childId = 2;

      // root <-> child recommendation is present from both perspectives (same rec id 10)
      const recsByRecommender = new Map<number, Recommendation[]>([
        [rootId, [createRecommendation(10, rootId, childId)]],
        [childId, [createRecommendation(10, rootId, childId)]],
      ]);

      jest
        .spyOn(recommendationService, 'getAllRecommendationsByRecommenderId')
        .mockImplementation((id: number) => Promise.resolve(recsByRecommender.get(id) ?? []));
      jest.spyOn(recommendationService, 'getRecommendationsByRecommendedId').mockResolvedValue([]);
      jest.spyOn(userService, 'getAllUserDataUsers').mockResolvedValue([]);
      jest.spyOn(userService, 'getRefUsersByRefs').mockResolvedValue([]);
      jest.spyOn(userService, 'getUsersByUsedRefs').mockResolvedValue([]);

      mockUserDatasForRequestedIds();

      const graph = await service.getRecommendationGraph(rootId);

      // both endpoints reached -> edge kept
      expect(graph.nodes.map((n) => n.id).sort((a, b) => a - b)).toEqual([rootId, childId]);
      expect(graph.edges.filter((e) => e.kind === RecommendationGraphEdgeKind.RECOMMENDATION)).toHaveLength(1);
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
});
