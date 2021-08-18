import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateLanguageDto } from './dto/create-language.dto';
import { UpdateLanguageDto } from './dto/update-language.dto';
import { Language } from './language.entity';
import { isString } from 'class-validator';

@EntityRepository(Language)
export class LanguageRepository extends Repository<Language> {
  async createLanguage(createLanguageDto: CreateLanguageDto): Promise<any> {
    if (createLanguageDto.id) delete createLanguageDto.id;
    if (createLanguageDto.created) delete createLanguageDto.created;

    const language = this.create(createLanguageDto);

    try {
      await this.save(language);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return language;
  }

  async getAllLanguage(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getLanguage(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      const language = await this.findOne({ id: key.key });

      if (language) return language;
    } else if (isString(key.key)) {
      let language = await this.findOne({ symbol: key.key });

      if (language) return language;

      language = await this.findOne({ name: key.key });

      if (language) return language;

      throw new NotFoundException('No matching language found');
    } else if (!isNaN(key)) {
      const language = await this.findOne({ id: key });

      if (language) return language;
    } else if (isString(key)) {
      let language = await this.findOne({ symbol: key });

      if (language) return language;

      language = await this.findOne({ name: key });

      if (language) return language;

      throw new NotFoundException('No matching language found');
    } else if (key.id) {
      const language = await this.findOne({ id: key.id });

      if (language) return language;

      throw new NotFoundException('No matching language found');
    } else if (key.symbol) {
      const language = await this.findOne({ name: key.symbol });

      if (language) return language;

      throw new NotFoundException('No matching language found');
    } else if (key.name) {
      const language = await this.findOne({ name: key.symbol });

      if (language) return language;

      throw new NotFoundException('No matching language found');
    }

    throw new BadRequestException(
      'key must be number or string or JSON-Object',
    );
  }

  async updateLanguage(editLanguageDto: UpdateLanguageDto): Promise<any> {
    try {
      const currentLanguage = await this.findOne({ id: editLanguageDto.id });
      if (!currentLanguage)
        throw new NotFoundException('No matching country found');

      editLanguageDto.created = currentLanguage.created;

      return Object.assign(currentLanguage, await this.save(editLanguageDto));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
