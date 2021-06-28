import { TypeOrmConfig } from "src/config/typeorm.config";
import {Entity, PrimaryGeneratedColumn, Column, PrimaryColumn} from "typeorm"; 
import * as typeorm from 'typeorm'

@Entity() 
export class User {   

   @PrimaryColumn({type:'varchar','unique':true,length:34}) 
   address: string; 
   
   @PrimaryGeneratedColumn({type:'int'}) 
   ref: number; 
   
   @Column({type:'varchar','unique':true,length:88}) 
   signature: string; 

   @Column({type:'varchar',length:64}) 
   mail: string; 

   @Column({type:'int',length:3, 'default':0}) 
   wallet_id: number;  //TODO: Objekt Referenzieren

   @Column({type: 'int',length:11, 'default':0}) 
   used_ref: number;

   @Column({type:'varchar',length:64}) 
   firstname: string; 

   @Column({type:'varchar',length:64}) 
   surname: string; 

   @Column({type:'varchar',length:64}) 
   street: string; 

   @Column({type:'varchar',length:5}) 
   house_number: string; 

   @Column({type:'varchar',length:64}) 
   location: string; 

   @Column({type:'varchar',length:9}) 
   zip: string; 

   @Column({type:'varchar',length:3}) 
   country: string; 

   @Column({type:'varchar',length:15}) 
   phone_number: string; 
}