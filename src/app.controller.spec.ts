import { Test, TestingModule } from '@nestjs/testing';
import { Config, ConfigService } from './config/config';
import { IsSwissPaymentTextValidator } from './shared/validators/is-swiss-payment-text.validator';
import { AppController } from './app.controller';
import { SettingService } from './shared/models/setting/setting.service';
import { HttpService } from './shared/services/http.service';
import { RefService } from './subdomains/core/referral/process/ref.service';

describe('AppController', () => {
  let controller: AppController;

  beforeAll(() => {
    new ConfigService();
  });

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

  describe('getConfig', () => {
    it('should expose the swissPaymentText validation format', () => {
      const { formats } = controller.getConfig();

      expect(formats.swissPaymentText).toEqual({
        pattern: Config.formats.swissPaymentText.source,
        flags: Config.formats.swissPaymentText.flags,
      });
    });

    it('should expose a pattern that is recompilable to the exact server-side regex (no drift)', () => {
      const { pattern, flags } = controller.getConfig().formats.swissPaymentText;
      const validator = new IsSwissPaymentTextValidator();

      const clientRegex = new RegExp(pattern, flags);

      const samples = [
        // accepted by the server validator
        'Bahnhofstrasse 1',
        '1011 AB', // NL
        'EC1A 1BB', // UK
        'K1A 0B1', // CA
        'D02 AF30', // IE
        'Zürich',
        'Genève',
        'Müller',
        'Évian',
        '',
        // rejected by the server validator
        '😀',
        'Москва',
        '北京',
      ];

      for (const sample of samples) {
        expect(clientRegex.test(sample)).toBe(validator.validate(sample));
      }
    });
  });
});
