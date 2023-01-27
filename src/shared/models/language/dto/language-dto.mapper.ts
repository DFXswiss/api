import { Language } from '../language.entity';
import { LanguageDto } from './language.dto';

export class LanguageDtoMapper {
  static entityToDto(language: Language): LanguageDto {
    const dto: LanguageDto = {
      id: language.id,
      name: language.name,
      symbol: language.symbol,
      foreignName: language.foreignName,
      enable: language.enable,
    };

    return Object.assign(new LanguageDto(), dto);
  }

  static entitiesToDto(languages: Language[]): LanguageDto[] {
    return languages.map(LanguageDtoMapper.entityToDto);
  }
}
