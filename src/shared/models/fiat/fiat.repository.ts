import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateFiatDto } from './dto/create-fiat.dto';
import { UpdateFiatDto } from './dto/update-fiat.dto';
import { Fiat } from './fiat.entity';
import { isString } from 'class-validator';

@EntityRepository(Fiat)
export class FiatRepository extends Repository<Fiat> {
  async createFiat(createFiatDto: CreateFiatDto): Promise<any> {
    const fiat = this.create(createFiatDto);

    try {
      await this.save(fiat);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return fiat;
  }

  async getAllFiat(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateFiat(fiat: UpdateFiatDto): Promise<any> {
    try {
      const currentFiat = await this.findOne({ id: fiat.id });

      if (!currentFiat) throw new NotFoundException('No matching fiat for id found');

      return Object.assign(currentFiat, await this.save(fiat));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getFiat(key: any): Promise<Fiat> {
    if (key.key) {
      if (!isNaN(key.key)) {
        const fiat = await this.findOne({ id: key.key });

        if (fiat) return fiat;

        throw new NotFoundException('No matching fiat found');
      } else if (isString(key.key)) {
        const fiat = await this.findOne({ name: key.key });

        if (fiat) return fiat;

        throw new NotFoundException('No matching fiat found');
      }
    } else if (!isNaN(key)) {
      const fiat = await this.findOne({ id: key });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    } else if (isString(key)) {
      const fiat = await this.findOne({ name: key });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    } else if (key.id) {
      const fiat = await this.findOne({ id: key.id });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    } else if (key.name) {
      const fiat = await this.findOne({ name: key.name });

      if (fiat) return fiat;

      throw new NotFoundException('No matching fiat found');
    }

    throw new BadRequestException('key must be number or string or JSON-Object');
  }
}
