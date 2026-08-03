import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';

jest.mock('./config/config', () => ({ Config: { formats: { ref: /^(\w{1,3}-\w{1,3})$/ } } }));

import { AppController } from './app.controller';
import { SettingService } from './shared/models/setting/setting.service';
import { RefService } from './subdomains/core/referral/process/ref.service';

describe('AppController', () => {
  let controller: AppController;
  let addOrUpdate: jest.Mock;
  let getSetting: jest.Mock;
  let response: Pick<Response, 'redirect'>;

  beforeEach(async () => {
    addOrUpdate = jest.fn();
    getSetting = jest.fn().mockResolvedValue({ denario: '123-456' });
    response = { redirect: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: RefService, useValue: { addOrUpdate } },
        { provide: SettingService, useValue: { getObj: getSetting } },
      ],
    }).compile();

    controller = app.get<AppController>(AppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('referral redirects', () => {
    it('stores the resolved permanent alias on the generic app route', async () => {
      await controller.createRefNew('192.0.2.1', 'denario', undefined, response as Response);

      expect(getSetting).toHaveBeenCalledWith('ref-keys', {});
      expect(addOrUpdate).toHaveBeenCalledWith('192.0.2.1', '123-456', undefined);
      expect(response.redirect).toHaveBeenCalledWith(307, 'https://dfx.swiss/');
    });

    it('stores the resolved permanent alias on the services route', async () => {
      await controller.redirectToStore(
        '192.0.2.2',
        'services' as never,
        'denario',
        undefined,
        { headers: {} } as Request,
        response as Response,
      );

      expect(addOrUpdate).toHaveBeenCalledWith('192.0.2.2', '123-456', undefined);
      expect(response.redirect).toHaveBeenCalledWith(303, 'https://app.dfx.swiss/');
    });

    it('keeps direct referral codes unchanged', async () => {
      await controller.createRefNew('192.0.2.3', '654-321', undefined, response as Response);

      expect(addOrUpdate).toHaveBeenCalledWith('192.0.2.3', '654-321', undefined);
    });

    it('does not persist an unknown alias without an origin', async () => {
      getSetting.mockResolvedValue({});

      await controller.createRefNew('192.0.2.4', 'unknown', undefined, response as Response);

      expect(addOrUpdate).not.toHaveBeenCalled();
      expect(response.redirect).toHaveBeenCalledWith(307, 'https://dfx.swiss/');
    });

    it('persists an origin even when no referral alias resolves', async () => {
      getSetting.mockResolvedValue({});

      await controller.createRefNew('192.0.2.5', 'unknown', 'denario-app', response as Response);

      expect(addOrUpdate).toHaveBeenCalledWith('192.0.2.5', undefined, 'denario-app');
    });

    it('does not resolve a prototype member as a referral alias', async () => {
      getSetting.mockResolvedValue({ denario: '123-456' });

      await controller.createRefNew('192.0.2.6', '__proto__', undefined, response as Response);

      expect(addOrUpdate).not.toHaveBeenCalled();
    });
  });
});
