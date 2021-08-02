import {
    InternalServerErrorException,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
  } from '@nestjs/common';
  import { EntityRepository, Repository } from 'typeorm';
  import { CreatePaymentDto } from './dto/create-payment.dto';
  import { CreateBuyPaymentDto } from './dto/create-buy-payment.dto';
  import { CreateSellPaymentDto } from './dto/create-sell-payment.dto';
  import { UpdatePaymentDto } from './dto/update-payment.dto';
  import { Payment, PaymentError, PaymentStatus, PaymentType } from './payment.entity';
  import { FiatRepository } from 'src/fiat/fiat.repository';
  import { getManager } from 'typeorm';
  import { AssetRepository } from 'src/asset/asset.repository';
  import { BuyRepository } from 'src/buy/buy.repository';

  @EntityRepository(Payment)
  export class PaymentRepository extends Repository<Payment> {
    async createPayment(createPaymentDto: CreatePaymentDto): Promise<any> {

        if (createPaymentDto.id) delete createPaymentDto.id;
        if (createPaymentDto.created) delete createPaymentDto.created;

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

    async createBuyPayment(createPaymentDto: CreateBuyPaymentDto): Promise<any> {

        if (createPaymentDto.id) delete createPaymentDto.id;
        if (createPaymentDto.created) delete createPaymentDto.created;

        let assetObject = null;
        let fiatObject = null;
        let buy = null;

        try{
            fiatObject = await getManager().getCustomRepository(FiatRepository).getFiat(createPaymentDto.fiat);

            createPaymentDto.fiat = fiatObject.id;
        }catch{
            createPaymentDto.info = "Wrong Fiat: " + createPaymentDto.fiat;
            createPaymentDto.fiat = null;
            createPaymentDto.errorCode = PaymentError.FIAT;
        }

        if(createPaymentDto.bankUsage) buy = await getManager().getCustomRepository(BuyRepository).getBuyByBankUsage(createPaymentDto.bankUsage);

        if(buy){

            createPaymentDto.address = buy.address;

            if(!buy.iban || !createPaymentDto.iban){
                createPaymentDto.info = "Missing IBAN: " + createPaymentDto.iban + ", " + buy.iban;
                createPaymentDto.iban = null;
                createPaymentDto.errorCode = PaymentError.IBAN;
            }else if(buy.iban != createPaymentDto.iban){
                createPaymentDto.info = "Wrong IBAN: " + createPaymentDto.iban + " instead of " + buy.iban;
                createPaymentDto.iban = null;
                createPaymentDto.errorCode = PaymentError.IBAN;
            }

            assetObject = await getManager().getCustomRepository(AssetRepository).getAsset(buy.asset);

            if(assetObject.buyable == 1){
                createPaymentDto.asset = assetObject.id;
            }else{
                createPaymentDto.info = "Asset not buyable: " + createPaymentDto.asset;
                createPaymentDto.asset = null;
                createPaymentDto.errorCode = PaymentError.ASSET;
            }
        }else{
            createPaymentDto.info = "Wrong BankUsage: " + createPaymentDto.bankUsage;
            createPaymentDto.asset = null;
            createPaymentDto.errorCode = PaymentError.BANKUSAGE;
        }

        createPaymentDto.type = PaymentType.BUY;

        const payment = this.create(createPaymentDto);

        if (payment) {
            await this.save(payment);
            payment.fiat = fiatObject;
            payment.asset = assetObject
        }
        return payment;

    }

    async createSellPayment(createPaymentDto: CreateSellPaymentDto): Promise<any> {

        if (createPaymentDto.id) delete createPaymentDto.id;
        if (createPaymentDto.created) delete createPaymentDto.created;

        let assetObject = null;
        let fiatObject = null;
        let assetIndex = null;

        if(createPaymentDto.fiat){
            try{
                fiatObject = await getManager().getCustomRepository(FiatRepository).getFiat(createPaymentDto.fiat);

                createPaymentDto.fiat = fiatObject.id;
            }catch{
                createPaymentDto.info = "Wrong Fiat: " + createPaymentDto.fiat;
                createPaymentDto.fiat = null;
                createPaymentDto.errorCode = PaymentError.FIAT;
            }
        }else{
            createPaymentDto.info = "Wrong Fiat: " + createPaymentDto.fiat;
            createPaymentDto.fiat = null;
            createPaymentDto.errorCode = PaymentError.FIAT;
        }

        if(createPaymentDto.asset){
            try{
                assetObject = await getManager().getCustomRepository(AssetRepository).getAsset(assetIndex);

                if(assetObject.buyable == 1){
                    createPaymentDto.asset = assetObject.id;
                }else{
                    createPaymentDto.info = "Asset not buyable: " + createPaymentDto.asset;
                    createPaymentDto.asset = null;
                    createPaymentDto.errorCode = PaymentError.ASSET;
                }
            }catch{
                createPaymentDto.info = "Wrong Asset: " + createPaymentDto.asset;
                createPaymentDto.asset = null;
                createPaymentDto.errorCode = PaymentError.ASSET; 
            }
        }else{
            createPaymentDto.info = "Wrong Asset: " + createPaymentDto.asset;
            createPaymentDto.asset = null;
            createPaymentDto.errorCode = PaymentError.ASSET;
        }

        createPaymentDto.type = PaymentType.SELL;

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
    
        currentPayment.status = payment.status;

        await this.save(currentPayment);

        const newPayment = await this.findOne({ "id": payment.id });

        if(newPayment) {
            if(newPayment.fiat) newPayment.fiat = await getManager().getCustomRepository(FiatRepository).getFiat(newPayment.fiat);
            if(newPayment.asset) newPayment.asset = await getManager().getCustomRepository(AssetRepository).getAsset(newPayment.asset);
        }

        return newPayment;
    }

    async getAllPayment(): Promise<any> {

        const payment = await this.find();
    
        if(payment){
            for (let a = 0; a < payment.length; a++) {
                if(payment[a].fiat) payment[a].fiat = (await getManager().getCustomRepository(FiatRepository).getFiat(payment[a].fiat)).name;
                if(payment[a].asset) payment[a].asset = (await getManager().getCustomRepository(AssetRepository).getAsset(payment[a].asset)).name;
            }
        }

        return payment;
    }

    async getPayment(id: any): Promise<any> {

        if (!isNaN(id.key)) {
            const payment = await this.findOne({ "id": id.key });

            if(!payment) throw new NotFoundException('No matching payment for id found');
                
            if(payment.fiat) payment.fiat = await getManager().getCustomRepository(FiatRepository).getFiat(payment.fiat);
            if(payment.asset) payment.asset = await getManager().getCustomRepository(AssetRepository).getAsset(payment.asset);

            return payment;
        }else if(!isNaN(id)){
            const payment = await this.findOne({ "id": id });

            if(!payment) throw new NotFoundException('No matching payment for id found');
                
            if(payment.fiat) payment.fiat = await getManager().getCustomRepository(FiatRepository).getFiat(payment.fiat);
            if(payment.asset) payment.asset = await getManager().getCustomRepository(AssetRepository).getAsset(payment.asset);

            return payment;
        }
        throw new BadRequestException('id must be a number');
    }

    async getUnprocessedPayment(): Promise<any> {

        const payment = await this.find({ "status": PaymentStatus.UNPROCESSED });
    
        if(payment){
            for (let a = 0; a < payment.length; a++) {
                if(payment[a].fiat) payment[a].fiat = (await getManager().getCustomRepository(FiatRepository).getFiat(payment[a].fiat)).name;
                if(payment[a].asset) payment[a].asset = (await getManager().getCustomRepository(AssetRepository).getAsset(payment[a].asset)).name;
            }
        }

        return payment;
    }
}
