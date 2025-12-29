import { Test } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { Blockchain } from '../enums/blockchain.enum';
import { CryptoService } from '../services/crypto.service';

describe('CryptoService', () => {
  beforeAll(async () => {
    const config = {};

    await Test.createTestingModule({
      providers: [TestUtil.provideConfig(config)],
    }).compile();
  });

  it('should match bitcoin addresses', async () => {
    expect(getBlockchain('12uP2ZgBQ7AG56yLdzW4fyyPzELQmitPBB')).toEqual(Blockchain.BITCOIN);
    expect(getBlockchain('31h4ReawbCsXXU5iX9YjPDHjPQmvymCyVo')).toEqual(Blockchain.BITCOIN);
    expect(getBlockchain('bc1q04fhuhexv662d58y205zhngrkryfpr4lmfxedz')).toEqual(Blockchain.BITCOIN);
    expect(getBlockchain('bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej')).toEqual(Blockchain.BITCOIN);
  });

  it('should match lightning addresses', async () => {
    expect(getBlockchain('LNURL1DP68GURN8GHJ77P09EMK2MRV944KUMMHDCHKCMN4WFK8QTMDUMFNU2')).toEqual(Blockchain.LIGHTNING);
    expect(
      getBlockchain(
        'LNURL1DP68GURN8GHJ7ARGD9EJ66TN94SJ6AN9WFUJ6MR0DENJ6ER0D4SKJM3DDESK6EFWVDHK6TEWWAJKCMPDDDHX7AMW9AKXUATJD3CZ7ARGD9EJ66TN94SKCUM094SJ6AN9WFUJ6MR0DENJ6ATNV4EZ6MNPD4JSCYAVPM',
      ),
    ).toEqual(Blockchain.LIGHTNING);
    expect(getBlockchain('LNNID028BA6A31FF9E824A945DE0E7B7C9F458195F4110A1FF161A599248F3AD9D1B1FD')).toEqual(
      Blockchain.LIGHTNING,
    );
    expect(
      getBlockchain(
        'LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5AXGDMZVDSNXWP3XQ6NJDFSV93XXETPXA3XYCF5V56RVDFCX9JKVDP58YMXGWPJX4SNXVF4XQERGENPX4QXSAR5WPEN5TE0XYERGDTRVFSNGC3JX3SKVVP3XGHXZTTKV4E8JTTVDAHXWTTPV3J8YETNWVH8VMMVW3SKWETPWPCZU6T09AKXUERGW43Z7ETCWSHST8R565',
      ),
    ).toEqual(Blockchain.LIGHTNING);
  });

  it('should match ethereum addresses', async () => {
    expect(getBlockchain('0x623777Cc098C6058a46cF7530f45150ff6a8459D')).toEqual(Blockchain.ETHEREUM);
  });

  it('should match monero addresses', async () => {
    expect(
      getBlockchain('43W78fdGV2ncSmu8EbSUTZU53huYiS5HoVDVvxaRrUpz3syHrBfsAQPGbMnhtY19xk6dXJSMoPt9wZCksK98ncq7NUSFTBU'),
    ).toEqual(Blockchain.MONERO);
    expect(
      getBlockchain('88q8rtLE9zsPjdvoY4WmBFJ9WXj3zghijeeDbihZAFg8EDPdJPhYj5Q9w9K1k5ghSQgyALKHrQiNUYdG2An8PSFnBwFpvC1'),
    ).toEqual(Blockchain.MONERO);
  });

  it('should match zano addresses', async () => {
    expect(
      getBlockchain(
        'ZxCkEgHf3ci8hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPC1zT8rneEf',
      ),
    ).toEqual(Blockchain.ZANO);
    expect(
      getBlockchain(
        'iZ2EMyPD7g28hgBfboZeCENaYrHBYZ1bLFi5cgWvn4WJLaxfgs4kqG6cJi9ai2zrXWSCpsvRXit14gKjeijx6YPCLJCxmeGP5Bm1R1rRJiNz',
      ),
    ).toEqual(Blockchain.ZANO);
  });

  it('should match liquid addresses', async () => {
    expect(getBlockchain('VTpwKsrwasw7VnNf4GHMmcjNY3MR2Q81GaxDv7EyhVS8rzj5exX5b5PF6g29Szb4jrMqKSUwP2ZGnXt4')).toEqual(
      Blockchain.LIQUID,
    );
    expect(getBlockchain('VJL8GbXwhTdzGtNEqRTLGvd3ELddCstc3kwCHgymUEkBDgB1goXxa2nPeyzyTuSRXu5ic3miVt4JGdfQ')).toEqual(
      Blockchain.LIQUID,
    );
  });

  it('should match arweave addresses', async () => {
    expect(getBlockchain('hFYGx4BUJROxNCxpg8gKcwWTybgpDbWmEIBkyW5PzqM')).toEqual(Blockchain.ARWEAVE);
    expect(getBlockchain('w5AtiFsNvORfcRtikbdrp2tzqixb05vdPw-ZhgVkD70')).toEqual(Blockchain.ARWEAVE);
  });

  it('should match cardano addresses', async () => {
    expect(getBlockchain('stake1uyug7rr6y6lwweqgaa6czw332erm5dcujntp3mnyjtthksg2gshqa')).toEqual(Blockchain.CARDANO);
  });

  it('should match solana addresses', async () => {
    expect(getBlockchain('LUKAzPV8dDbVykTVT14pCGKzFfNcgZgRbAXB8AGdKx3')).toEqual(Blockchain.SOLANA);
    expect(getBlockchain('oQPnhXAbLbMuKHESaGrbXT17CyvWCpLyERSJA9HCYd7')).toEqual(Blockchain.SOLANA);
  });

  it('should match tron addresses', async () => {
    expect(getBlockchain('TRmumx428iKqDQkBMhtjK8DQgcfYK7NdZP')).toEqual(Blockchain.TRON);
  });
});

function getBlockchain(address: string): Blockchain {
  return CryptoService.getDefaultBlockchainBasedOn(address);
}
