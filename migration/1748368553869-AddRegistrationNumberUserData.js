module.exports = class AddRegistrationNumberUserData1748368553869 {
    name = 'AddRegistrationNumberUserData1748368553869'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_f6c5805e908317b6cd6ae0ebad8"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "amlRule"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "regionManager"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "storeManager"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "storeOwner"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "minAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "maxAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP COLUMN "minAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP COLUMN "maxAmount"`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "registrationNumber" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "amount" float`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD "targetAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP COLUMN "targetAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "amount"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "registrationNumber"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD "maxAmount" float`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD "minAmount" float`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "maxAmount" float`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "minAmount" float`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "storeOwner" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "storeManager" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "regionManager" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "country" ADD "amlRule" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "country" ADD CONSTRAINT "DF_f6c5805e908317b6cd6ae0ebad8" DEFAULT 0 FOR "amlRule"`);
    }
}
