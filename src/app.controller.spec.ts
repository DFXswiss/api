import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { HttpService } from './shared/services/http.service';
import { SettingService } from './shared/models/setting/setting.service';
import { RefService } from './subdomains/core/referral/process/ref.service';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: RefService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: SettingService, useValue: {} },
      ],
    }).compile();

     
    controller = app.get<AppController>(AppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
