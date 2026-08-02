import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { AdminService } from '../admin.service';
import { PayoutRequestContext, PayoutRequestDto } from '../dto/payout-request.dto';

describe('AdminService', () => {
  let service: AdminService;
  let assetService: DeepMocked<AssetService>;
  let dexService: DeepMocked<DexService>;
  let payoutService: DeepMocked<PayoutService>;
  let settingService: DeepMocked<SettingService>;

  const createRequest = (address: string): PayoutRequestDto => ({
    context: PayoutRequestContext.MANUAL as PayoutRequestDto['context'],
    id: 'manual-payout',
    amount: 1,
    assetId: 1,
    address,
  });

  beforeEach(() => {
    assetService = createMock<AssetService>();
    dexService = createMock<DexService>();
    payoutService = createMock<PayoutService>();
    settingService = createMock<SettingService>();
    service = new AdminService(assetService, dexService, payoutService, settingService);

    assetService.getAssetById.mockResolvedValue({ id: 1, blockchain: Blockchain.ETHEREUM } as Asset);
    dexService.hasOrder.mockResolvedValue(false);
  });

  it('accepts a checksummed EVM payout address from the allowlist without changing the destination', async () => {
    const address = '0x52908400098527886E0F7030069857D2E4169EE7';
    settingService.getObj.mockResolvedValue([address]);

    await service.payout(createRequest(address));

    expect(payoutService.doPayout).toHaveBeenCalledWith(expect.objectContaining({ destinationAddress: address }));
  });

  it('rejects an EVM payout address that is not in the allowlist', async () => {
    settingService.getObj.mockResolvedValue(['0x52908400098527886E0F7030069857D2E4169EE7']);

    await expect(service.payout(createRequest('0xde709f2102306220921060314715629080e2fb77'))).rejects.toThrow(
      new BadRequestException('Payout address not permitted'),
    );
    expect(dexService.reserveLiquidity).not.toHaveBeenCalled();
    expect(payoutService.doPayout).not.toHaveBeenCalled();
  });

  it('enforces case-sensitive allowlist matching for non-EVM payout addresses', async () => {
    const allowedAddress = 'bc1qCaseSensitiveAddress';
    assetService.getAssetById.mockResolvedValue({ id: 1, blockchain: Blockchain.BITCOIN } as Asset);
    settingService.getObj.mockResolvedValue([allowedAddress]);

    await expect(service.payout(createRequest(allowedAddress.toLowerCase()))).rejects.toThrow(
      new BadRequestException('Payout address not permitted'),
    );
    expect(dexService.reserveLiquidity).not.toHaveBeenCalled();
    expect(payoutService.doPayout).not.toHaveBeenCalled();
  });

  it('fails closed when the payout allowlist setting contains no string addresses', async () => {
    settingService.getObj.mockResolvedValue([42] as any);

    await expect(service.payout(createRequest('0x52908400098527886E0F7030069857D2E4169EE7'))).rejects.toThrow(
      new BadRequestException('Payout address not permitted'),
    );
    expect(dexService.reserveLiquidity).not.toHaveBeenCalled();
    expect(payoutService.doPayout).not.toHaveBeenCalled();
  });
});
