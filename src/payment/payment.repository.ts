import {
    InternalServerErrorException,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
  } from '@nestjs/common';
  import { EntityRepository, Repository } from 'typeorm';
  import { CreatePaymentDto } from './dto/create-payment.dto';
  import { UpdatePaymentDto } from './dto/update-payment.dto';
  import { Payment } from './payment.entity';
  import { FiatRepository } from 'src/fiat/fiat.repository';
  import { getManager } from 'typeorm';
  import { AssetRepository } from 'src/asset/asset.repository';

  @EntityRepository(Payment)
  export class PaymentRepository extends Repository<Payment> {
    async createPayment(createPaymentDto: CreatePaymentDto): Promise<any> {

        if (createPaymentDto.id) delete createPaymentDto['id'];

        const fiatObject = await getManager()
        .getCustomRepository(FiatRepository)
        .getFiat(createPaymentDto.fiat);

        const assetObject = await getManager()
        .getCustomRepository(AssetRepository)
        .getAsset(createPaymentDto.asset);

        createPaymentDto.asset = assetObject.id;
        createPaymentDto.fiat = fiatObject.id;

        const payment = this.create(createPaymentDto);

        if (payment) {
            await this.save(payment);
            payment.fiat = fiatObject;
            payment.asset = assetObject
        }
        return payment;
    }

    async updatePayment(payment: UpdatePaymentDto): Promise<any> {
        const currentPayment = await this.findOne({ "id": payment.id });
    
        if (!currentPayment)
          throw new NotFoundException('No matching payment for id found');
    
        currentPayment.processed = payment.processed;

        await this.save(currentPayment);

        const newPayment = await this.findOne({ "id": payment.id });

        if(newPayment) {
            newPayment.fiat = await getManager().getCustomRepository(FiatRepository).getFiat(newPayment.fiat);
            newPayment.asset = await getManager().getCustomRepository(AssetRepository).getAsset(newPayment.asset);
        }

        return newPayment;
    }

    async getAllPayment(): Promise<any> {
        //TODO Schleife durch alle buy und fiat id mit objekt ersetzen
      // + Adresse löschen
        return await this.find();
    }

    async getPayment(id: any): Promise<any> {

        if (!isNaN(id.key)) {
            const payment = await this.findOne({ "id": id.key });

            if(!payment) throw new NotFoundException('No matching payment for id found');
                
            payment.fiat = await getManager().getCustomRepository(FiatRepository).getFiat(payment.fiat);
            payment.asset = await getManager().getCustomRepository(AssetRepository).getAsset(payment.asset);

            return payment;
        }else if(!isNaN(id)){
            const payment = await this.findOne({ "id": id });

            if(!payment) throw new NotFoundException('No matching payment for id found');
                
            payment.fiat = await getManager().getCustomRepository(FiatRepository).getFiat(payment.fiat);
            payment.asset = await getManager().getCustomRepository(AssetRepository).getAsset(payment.asset);

            return payment;
        }
        throw new BadRequestException('id must be a number');
    }

    async getUnprocessedPayment(): Promise<any> {
        //TODO Schleife durch alle buy und fiat id mit objekt ersetzen
      // + Adresse löschen
        return await this.find({ "processed": false });
    }
}
