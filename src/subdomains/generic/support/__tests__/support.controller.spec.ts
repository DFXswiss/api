import { createMock } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { RecommendationGraph } from '../dto/user-data-support.dto';
import { SupportIssueTemplateService } from '../services/support-issue-template.service';
import { SupportNoteService } from '../services/support-note.service';
import { SupportController } from '../support.controller';
import { SupportService } from '../support.service';

describe('SupportController', () => {
  let controller: SupportController;

  let supportService: SupportService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SupportController, TestUtil.provideConfig()],
    })
      .useMocker((token) => {
        if (token === SupportService) return createMock<SupportService>();
        if (token === SupportNoteService) return createMock<SupportNoteService>();
        if (token === SupportIssueTemplateService) return createMock<SupportIssueTemplateService>();
        return createMock();
      })
      .compile();

    controller = module.get(SupportController);
    supportService = module.get(SupportService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getRecommendationGraphNeighbors', () => {
    it('delegates to supportService.getRecommendationGraphNeighbors with parsed id and the query skip/take', async () => {
      const graph: RecommendationGraph = { nodes: [], edges: [], rootId: 42, hasMore: true };
      const spy = jest.spyOn(supportService, 'getRecommendationGraphNeighbors').mockResolvedValue(graph);

      // skip/take are already validated and number-transformed by the query DTO (RecommendationGraphNeighborsQuery)
      const result = await controller.getRecommendationGraphNeighbors('42', { skip: 10, take: 5 });

      expect(spy).toHaveBeenCalledWith(42, 10, 5);
      expect(result).toBe(graph);
    });

    it('passes undefined for skip and take when the query params are omitted (service defaults apply)', async () => {
      const graph: RecommendationGraph = { nodes: [], edges: [], rootId: 42 };
      const spy = jest.spyOn(supportService, 'getRecommendationGraphNeighbors').mockResolvedValue(graph);

      const result = await controller.getRecommendationGraphNeighbors('42', {});

      expect(spy).toHaveBeenCalledWith(42, undefined, undefined);
      expect(result).toBe(graph);
    });

    it('honors skip=0 instead of treating it as omitted', async () => {
      const graph: RecommendationGraph = { nodes: [], edges: [], rootId: 42 };
      const spy = jest.spyOn(supportService, 'getRecommendationGraphNeighbors').mockResolvedValue(graph);

      const result = await controller.getRecommendationGraphNeighbors('42', { skip: 0, take: 5 });

      expect(spy).toHaveBeenCalledWith(42, 0, 5);
      expect(result).toBe(graph);
    });
  });
});
