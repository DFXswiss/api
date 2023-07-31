import { log } from 'console';
import { readFileSync } from 'fs';
import { GetConfig } from '../config';

describe('Config', () => {
  it('CheckAddressFormat', async () => {
    process.env.ENVIRONMENT = 'prd';

    const addressFormat = GetConfig().formats.address;
    log(addressFormat);

    const addressExpression = new RegExp(addressFormat);

    const fileContent = readFileSync('C:/Users/Bernd/Downloads/addresses.csv', 'utf-8');
    const fileContentArray = fileContent.split(/\r?\n/).splice(1);
    log('LENGTH: ' + fileContentArray.length);

    for (const line of fileContentArray) {
      const address = line.split(',')[1];
      const testResult = addressExpression.test(address);

      if (!testResult) {
        log('RESULT: ' + line + ' / ' + testResult);
      }
    }
  });

  it('should match all addresses', async () => {
    process.env.ENVIRONMENT = 'prd';

    const addressFormat = GetConfig().formats.address;
    const addrExp = new RegExp(addressFormat);

    // Bitcoin
    expect(addrExp.test('12uP2ZgBQ7AG56yLdzW4fyyPzELQmitPBB')).toEqual(true);
    expect(addrExp.test('31h4ReawbCsXXU5iX9YjPDHjPQmvymCyVo')).toEqual(true);
    expect(addrExp.test('bc1q04fhuhexv662d58y205zhngrkryfpr4lmfxedz')).toEqual(true);
    expect(addrExp.test('bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej')).toEqual(true);

    // Taproot
    expect(addrExp.test('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toEqual(true);

    // Lightning
    expect(addrExp.test('LNURL1DP68GURN8GHJ77P09EMK2MRV944KUMMHDCHKCMN4WFK8QTMDUMFNU2')).toEqual(true);

    expect(
      addrExp.test(
        'LNURL1DP68GURN8GHJ7ARGD9EJ66TN94SJ6AN9WFUJ6MR0DENJ6ER0D4SKJM3DDESK6EFWVDHK6TEWWAJKCMPDDDHX7AMW9AKXUATJD3CZ7ARGD9EJ66TN94SKCUM094SJ6AN9WFUJ6MR0DENJ6ATNV4EZ6MNPD4JSCYAVPM',
      ),
    ).toEqual(true);

    expect(addrExp.test('LNNID028BA6A31FF9E824A945DE0E7B7C9F458195F4110A1FF161A599248F3AD9D1B1FD')).toEqual(true);

    expect(
      addrExp.test(
        'LNDHUB1D3HXG6R4VGAZ7TMFDEMX76TRV5AXGDMZVDSNXWP3XQ6NJDFSV93XXETPXA3XYCF5V56RVDFCX9JKVDP58YMXGWPJX4SNXVF4XQERGENPX4QXSAR5WPEN5TE0XYERGDTRVFSNGC3JX3SKVVP3XGHXZTTKV4E8JTTVDAHXWTTPV3J8YETNWVH8VMMVW3SKWETPWPCZU6T09AKXUERGW43Z7ETCWSHST8R565',
      ),
    ).toEqual(true);

    // Etherium
    expect(addrExp.test('0x000341705b2bED92e0D6938Cc206fB0CD7F57d74')).toEqual(true);

    // Defichain
    expect(addrExp.test('8a2jKb8p6FWix6Q7prhWaCA8ghoTBttEBk')).toEqual(true);
    expect(addrExp.test('dak7adNN4FtfT4wADqZFPmPEDCfUfhaqD3')).toEqual(true);
    expect(addrExp.test('df1q000q5sykp9hwq3tyvucynl03sm9yt6y0np05ct')).toEqual(true);
  });
});
