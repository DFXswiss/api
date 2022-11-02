export enum Network {
  MAIN_NET = 'MainNet',
  TEST_NET = 'TestNet',
  PLAYGROUND = 'Playground',
  LOCAL = 'Local',
}

export enum Platform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

export class FlagDto {
  id: string;
  name: string;
  stage: 'beta' | 'public';
  version: string;
  description: string;
  networks: Network[];
  platforms: Platform[];
}
