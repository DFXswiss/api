import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateIntegratorDto } from './dto/create-integrator.dto';
import { Integrator } from './integrator.entity';
import { IntegratorRepository } from './integrator.repository';

@Injectable()
export class IntegratorService {
  constructor(private readonly repo: IntegratorRepository) {}

  async createIntegrator(dto: CreateIntegratorDto): Promise<Integrator> {
    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async updateIntegrator(id: number, dto: CreateIntegratorDto): Promise<Integrator> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException('Integrator not found');

    Object.assign(entity, dto);

    return this.repo.save(entity);
  }
}
