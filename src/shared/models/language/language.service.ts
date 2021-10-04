import {
    Injectable,
  } from '@nestjs/common';
  import { CreateLanguageDto } from 'src/shared/models/language/dto/create-language.dto';
  import { LanguageRepository } from 'src/shared/models/language/language.repository';
  import { UpdateLanguageDto } from './dto/update-language.dto';
  
  @Injectable()
  export class LanguageService {
    constructor(private languageRepository: LanguageRepository) {}
  
    async createLanguage(createLanguageDto: CreateLanguageDto): Promise<any> {
      return this.languageRepository.createLanguage(createLanguageDto);
    }
  
    async getAllLanguage(): Promise<any> {
      return this.languageRepository.getAllLanguage();
    }
  
    async updateLanguage(language: UpdateLanguageDto): Promise<string> {
      return this.languageRepository.updateLanguage(language);
    }
  
    async getLanguage(key: any): Promise<any> {
      return this.languageRepository.getLanguage(key);
    }
  }