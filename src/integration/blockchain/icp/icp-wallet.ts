import { HttpAgent } from '@dfinity/agent';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { Principal } from '@dfinity/principal';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

const internetComputerDefaultPath = "m/44'/223'/0'/0'/0'";

export class InternetComputerWallet {
  constructor(
    private readonly identity: Ed25519KeyIdentity,
    readonly principal: Principal,
  ) {}

  static fromSeed(seed: string, index: number): InternetComputerWallet {
    const hdKey = HDKey.fromMasterSeed(mnemonicToSeedSync(seed, ''));
    const path = InternetComputerWallet.getPathFor(index);

    const privateKey = hdKey.derive(path).privateKey;
    if (!privateKey) throw new Error(`Failed to derive private key for path ${path}`);

    const identity = Ed25519KeyIdentity.generate(privateKey);
    const principal = identity.getPrincipal();

    return new InternetComputerWallet(identity, principal);
  }

  private static getPathFor(index: number): string {
    const components = internetComputerDefaultPath.split('/');
    components[components.length - 1] = `${index.toString()}'`;
    return components.join('/');
  }

  get address(): string {
    return this.principal.toText();
  }

  getAgent(host: string): HttpAgent {
    return HttpAgent.createSync({ identity: this.identity, host });
  }
}
