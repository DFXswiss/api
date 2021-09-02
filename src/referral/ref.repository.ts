import {
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { isString } from 'class-validator';
import { Ref } from './ref.entity';
import { CreateRefDto } from './dto/create-ref.dto';
  
  @EntityRepository(Ref)
  export class RefRepository extends Repository<Ref> {
    async createRef(createRefDto: CreateRefDto): Promise<any> {
  
        let ref: Ref = null;

        const currentRef = await this.findOne({ip: createRefDto.ip});

        if(currentRef){
            ref = currentRef;
            ref.ref = createRefDto.ref;
        }else{
            ref = this.create(createRefDto);
        }
    
        try {
            await this.save(ref);
        } catch (error) {
            throw new ConflictException(error.message);
        }
        return ref;
    }

    async getRef(key: any): Promise<any> {
      if (key.key) {
        if (isString(key.key)) {
          const ref = await this.findOne({ ip: key.key });
  
          if (!ref) throw new NotFoundException('No matching ref for ip found');
          
          await this.delete(ref);

          return ref;
        }
      }else if(isString(key)) {
        const ref = await this.findOne({ ip: key });
  
        if (!ref) throw new NotFoundException('No matching ref for ip found'); 
  
        await this.delete(ref);
        return ref;
      }
  
      throw new BadRequestException(
        'key must be a string',
      );
    }
  }