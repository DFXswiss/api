import { Language } from '../language.entity';

const defaultLanguage: Partial<Language> = {
  id: 1,
  symbol: 'DE',
  name: 'Deutsch',
  updated: undefined,
  created: undefined,
};

export function createDefaultLanguage(): Language {
  return createCustomLanguage({});
}

export function createCustomLanguage(customValues: Partial<Language>): Language {
  return Object.assign(new Language(), { ...defaultLanguage, ...customValues });
}
