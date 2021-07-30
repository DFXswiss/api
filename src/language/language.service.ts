import {
    BadRequestException,
    Injectable,
    NotFoundException,
  } from '@nestjs/common';
  import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
  import { Repository } from 'typeorm';
  import { Language } from './language.entity';
  import { CreateLanguageDto } from 'src/language/dto/create-language.dto';
  import { LanguageRepository } from 'src/language/language.repository';
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