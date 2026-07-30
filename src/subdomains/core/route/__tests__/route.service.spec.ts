import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { EntityManager } from 'typeorm';
import { Route } from '../route.entity';
import { RouteRepository } from '../route.repository';
import { RouteService } from '../route.service';

describe('RouteService', () => {
  let service: RouteService;

  let routeRepo: RouteRepository;

  beforeEach(async () => {
    routeRepo = createMock<RouteRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [RouteService, { provide: RouteRepository, useValue: routeRepo }, TestUtil.provideConfig()],
    }).compile();

    service = module.get<RouteService>(RouteService);
  });

  describe('createRoute', () => {
    it('persists through the caller transaction so the route rolls back with its owner', async () => {
      const entity = { id: 5 } as Route;
      const manager = createMock<EntityManager>();
      jest.spyOn(routeRepo, 'create').mockReturnValue(entity);
      jest.spyOn(manager, 'save').mockResolvedValue(entity as never);

      await expect(service.createRoute({}, manager)).resolves.toBe(entity);

      expect(manager.save).toHaveBeenCalledWith(entity);
      // saving through the repository would commit the route outside the owner transaction
      expect(routeRepo.save).not.toHaveBeenCalled();
    });

    it('propagates a rejected insert instead of falling back to a separate commit', async () => {
      const manager = createMock<EntityManager>();
      jest.spyOn(manager, 'save').mockRejectedValue(new Error('rollback'));

      await expect(service.createRoute({}, manager)).rejects.toThrow('rollback');

      expect(routeRepo.save).not.toHaveBeenCalled();
    });
  });
});
