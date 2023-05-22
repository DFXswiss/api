import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { LightningClient } from './lightning-client';

@Injectable()
export class LightningService implements OnModuleInit {
  private readonly client: LightningClient;

  constructor(http: HttpService) {
    this.client = new LightningClient(http);
  }

  onModuleInit() {
    //void this.testGetBalance();
    //void this.testGetPayments();
    //void this.testGetLnUrlPLinks();
    //void this.testAddLnUrlPLink();
    //void this.testRemoveLnUrlPLink();
    //void this.testVerifySignature();
  }

  getDefaultClient(): LightningClient {
    return this.client;
  }

  async testGetBalance() {
    const balance = await this.client.getBalance();
    console.log('Wallet Balance: ' + balance);
    console.log('');
  }

  async testGetPayments() {
    const payments = await this.client.getPayments('f934dba08924ecff33300edff6323dae479b404044d3a6b014fe2f7e4bcca630');
    //const payments = await this.client.getPayments('3b2fdf4de02f14531ea305ae76c56d79a552a63a3f77daf44f6ec47b3ce08c79');

    console.log('Number of Payments: ' + payments.length);
    console.log('');

    for (const payment of payments) {
      console.log('Id:            ' + payment.checking_id);
      console.log('Pending:       ' + payment.pending);
      console.log('Amount:        ' + payment.amount);
      console.log('Memo:          ' + payment.memo);
      console.log('Time / Expiry: ' + payment.time + ' / ' + payment.expiry);
      console.log('Bolt11:        ' + payment.bolt11);
      console.log('');
    }
  }

  async testGetLnUrlPLinks() {
    const lnUrlPLinks = await this.client.getLnUrlPLinks();
    console.log('Number of LNURLp Links: ' + lnUrlPLinks.length);
    console.log('');

    for (const lnUrlPLink of lnUrlPLinks) {
      console.log('Id:          ' + lnUrlPLink.id);
      console.log('Description: ' + lnUrlPLink.description);
      console.log('Min / Max:   ' + lnUrlPLink.min + ' / ' + lnUrlPLink.max);
      console.log('LNURL:       ' + lnUrlPLink.lnurl);
      console.log('');
    }
  }

  async testAddLnUrlPLink() {
    const addedLnUrlPLink = await this.client.addLnUrlPLink('Test 1');

    console.log('Id:          ' + addedLnUrlPLink.id);
    console.log('Description: ' + addedLnUrlPLink.description);
    console.log('Min / Max:   ' + addedLnUrlPLink.min + ' / ' + addedLnUrlPLink.max);
    console.log('LNURL:       ' + addedLnUrlPLink.lnurl);
    console.log('');
  }

  async testRemoveLnUrlPLink() {
    const lnUrlPLinks = await this.client.getLnUrlPLinks();

    const foundLnUrlPLink = lnUrlPLinks.find((obj) => {
      return obj.description === 'Test 1';
    });

    if (foundLnUrlPLink) {
      const foundLnUrlPLinkId = foundLnUrlPLink.id;

      const success = await this.client.removeLnUrlPLink(foundLnUrlPLinkId);

      console.log('Remove LNURLp success: ' + success);
      console.log('');
    }
  }

  async testVerifySignature() {
    const message =
      'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_LNURL1DP68GURN8GHJ7VF3XSEKXC3JX3SK2TNY9EMX7MR5V9NK2CTSWQHXJME0D3H82UNVWQHKZURF9AMRZTMVDE6HYMP0X5LU9EJM';
    const signature =
      'rdtc8yopn8esk9ot9spnbqa5urbdo1wiehkg579so17kdgft1zmd4uqaayhnsjtumeew8k6iya5d9in7jn1jku8xeiskikoyihnj3ox7';

    const isValid = await this.client.verifySignature(message, signature);

    console.log('Is valid signature: ' + isValid);
    console.log('');
  }
}
