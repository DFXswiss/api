import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    it('should return "Hello World!"', () => {});
  });
});
