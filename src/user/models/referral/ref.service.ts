import { Injectable, NotFoundException } from '@nestjs/common';
import { Ref } from './ref.entity';
import { RefRepository } from './ref.repository';

@Injectable()
export class RefService {
  constructor(private refRepository: RefRepository) {}

  async addOrUpdate(ip: string, ref: string): Promise<Ref> {
    return this.refRepository.addOrUpdate(ip, ref);
  }

  async get(ip: string): Promise<string> {
    // registered refs expire after 3 days
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - 3);

    const ref = await this.refRepository.getAndRemove(ip);
    if (!ref || ref.created < expirationDate) throw new NotFoundException('No matching ref for ip found');

    return ref.ref;
  }
}
