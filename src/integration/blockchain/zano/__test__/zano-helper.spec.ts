import { Test } from '@nestjs/testing';
import { log } from 'console';
import { TestUtil } from 'src/shared/utils/test.util';
import { ZanoHelper } from '../zano-helper';

// Hex of "12345": 0000000000003039
// Hex of "987":   00000000000003db

describe('ZanoHelper', () => {
  beforeAll(async () => {
    const config = {
      blockchain: {
        zano: {
          wallet: {
            address:
              'ZxCkEgHf3ci8hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPC1zT8rneEf',
          },
        },
      },
    };

    await Test.createTestingModule({
      providers: [TestUtil.provideConfig(config)],
    }).compile();
  });

  it('should convert zano to au', () => {
    const au = ZanoHelper.zanoToAu(0.01);
    expect(au).toEqual(10000000000);
  });

  it('should convert au to zano', () => {
    const zano = ZanoHelper.auToZano(10000000000);
    expect(zano).toEqual(0.01);
  });

  it('should convert index to payment id hex', () => {
    const depositToPaymentIdHex = ZanoHelper.mapIndexToPaymentIdHex(12345);
    expect(depositToPaymentIdHex).toEqual('0000000000003039');

    const paymentToPaymentIdHex = ZanoHelper.mapIndexToPaymentIdHex(987);
    expect(paymentToPaymentIdHex).toEqual('00000000000003db');
  });

  it('should convert payment id hex to index', () => {
    const indexFromDepositPaymentIdHex = ZanoHelper.mapPaymentIdHexToIndex('0000000000003039');
    expect(indexFromDepositPaymentIdHex).toEqual(12345);

    const indexFromPaymentPaymentIdHex = ZanoHelper.mapPaymentIdHexToIndex('00000000000003db');
    expect(indexFromPaymentPaymentIdHex).toEqual(987);
  });

  it('should create deposit address', () => {
    const depositAddress = ZanoHelper.createDepositAddress(12345);
    expect(depositAddress).toEqual(
      'iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz',
    );
  });

  it('should split integrated address', () => {
    const zanoAddress = ZanoHelper.splitIntegratedAddress(
      'iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz',
    );
    log(JSON.stringify(zanoAddress));

    expect(zanoAddress.address).toEqual(
      'ZxCkEgHf3ci8hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPC1zT8rneEf',
    );
    expect(zanoAddress.depositAddress.address).toEqual(
      'iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz',
    );
    expect(zanoAddress.depositAddress.paymentId).toEqual('0000000000003039');
    expect(zanoAddress.depositAddress.accountIndex).toEqual(12345);
  });
});
