import { createMock } from '@golevelup/ts-jest';
import { Test } from '@nestjs/testing';
import { SelectQueryBuilder } from 'typeorm';
import { Recommendation } from '../recommendation.entity';
import { RecommendationRepository } from '../recommendation.repository';
import { RecommendationService } from '../recommendation.service';

describe('RecommendationService', () => {
  let service: RecommendationService;
  let recommendationRepo: RecommendationRepository;

  function mockQueryBuilder(rows: { id: string; count: string }[]): SelectQueryBuilder<Recommendation> {
    const builder = createMock<SelectQueryBuilder<Recommendation>>();
    jest.mocked(builder.select).mockReturnThis();
    jest.mocked(builder.addSelect).mockReturnThis();
    jest.mocked(builder.where).mockReturnThis();
    jest.mocked(builder.andWhere).mockReturnThis();
    jest.mocked(builder.groupBy).mockReturnThis();
    jest.mocked(builder.getRawMany).mockResolvedValue(rows);
    return builder;
  }

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [RecommendationService] })
      .useMocker(() => createMock())
      .compile();

    service = module.get(RecommendationService);
    recommendationRepo = module.get(RecommendationRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('countByRecommenderIds', () => {
    it('should return an empty array and not query when no ids are given', async () => {
      const result = await service.countByRecommenderIds([]);

      expect(result).toEqual([]);
      expect(recommendationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should map raw string rows to numeric id/count pairs', async () => {
      const builder = mockQueryBuilder([
        { id: '1', count: '3' },
        { id: '2', count: '10' },
      ]);
      jest.mocked(recommendationRepo.createQueryBuilder).mockReturnValue(builder);

      const result = await service.countByRecommenderIds([1, 2]);

      expect(result).toEqual([
        { id: 1, count: 3 },
        { id: 2, count: 10 },
      ]);
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].count).toBe('number');
      expect(recommendationRepo.createQueryBuilder).toHaveBeenCalledWith('recommendation');
      expect(builder.getRawMany).toHaveBeenCalled();
      // no excludeIds -> NOT IN clause omitted
      expect(builder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('NOT IN'), expect.anything());
    });

    it('adds the NOT IN exclude clause when excludeIds are given', async () => {
      const builder = mockQueryBuilder([{ id: '1', count: '2' }]);
      jest.mocked(recommendationRepo.createQueryBuilder).mockReturnValue(builder);

      await service.countByRecommenderIds([1, 2], [3, 4]);

      expect(builder.andWhere).toHaveBeenCalledWith('recommendation.recommendedId NOT IN (:...excludeIds)', {
        excludeIds: [3, 4],
      });
    });
  });

  describe('countByRecommendedIds', () => {
    it('should return an empty array and not query when no ids are given', async () => {
      const result = await service.countByRecommendedIds([]);

      expect(result).toEqual([]);
      expect(recommendationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should map raw string rows to numeric id/count pairs', async () => {
      const builder = mockQueryBuilder([{ id: '5', count: '2' }]);
      jest.mocked(recommendationRepo.createQueryBuilder).mockReturnValue(builder);

      const result = await service.countByRecommendedIds([5]);

      expect(result).toEqual([{ id: 5, count: 2 }]);
      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].count).toBe('number');
      expect(recommendationRepo.createQueryBuilder).toHaveBeenCalledWith('recommendation');
      expect(builder.getRawMany).toHaveBeenCalled();
      expect(builder.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('NOT IN'), expect.anything());
    });

    it('adds the NOT IN exclude clause when excludeIds are given', async () => {
      const builder = mockQueryBuilder([{ id: '5', count: '1' }]);
      jest.mocked(recommendationRepo.createQueryBuilder).mockReturnValue(builder);

      await service.countByRecommendedIds([5], [6, 7]);

      expect(builder.andWhere).toHaveBeenCalledWith('recommendation.recommenderId NOT IN (:...excludeIds)', {
        excludeIds: [6, 7],
      });
    });
  });
});
