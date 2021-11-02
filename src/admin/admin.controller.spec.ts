import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';

describe('AppController', () => {
  let adminController: AdminController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
    }).compile();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    adminController = app.get<AdminController>(AdminController);
  });

  describe('root', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    it('should return "Hello World!"', () => {});
  });
});
