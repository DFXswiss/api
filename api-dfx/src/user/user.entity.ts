import { TypeOrmConfig } from "src/config/typeorm.config";
import {Entity, PrimaryGeneratedColumn, Column, PrimaryColumn} from "typeorm"; 
import * as typeorm from 'typeorm'

@Entity() 
export class User {   

   @PrimaryColumn("varchar",{"unique":true,length:34}) 
   address: string; 
   
   @PrimaryGeneratedColumn() 
   ref: number; 
   
   @Column("varchar",{"unique":true,length:88}) 
   signature: string; 

   @Column("varchar",{length:64}) 
   mail: string; 

   @Column({length:3}) 
   wallet_id: number;  //TODO: Objekt Referenzieren

   @Column({length:11}) 
   used_ref: number;

   @Column("varchar",{length:39}) 
   ip: string; 

   @Column("varchar",{length:64}) 
   firstname: string; 

   @Column("varchar",{length:64}) 
   surname: string; 

   @Column("varchar",{length:64}) 
   street: string; 

   @Column("varchar",{length:5}) 
   house_number: string; 

   @Column("varchar",{length:64}) 
   location: string; 

   @Column("varchar",{length:9}) 
   zip: string; 

   @Column("varchar",{length:3}) 
   country: string; 

   @Column("varchar",{length:15}) 
   phone_number: string; 
}