"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const typeorm_config_1 = require("../config/typeorm.config");
const typeorm_1 = require("typeorm");
let User = class User {
};
__decorate([
    typeorm_1.PrimaryColumn({ type: 'varchar', 'unique': true, length: 34 }),
    __metadata("design:type", String)
], User.prototype, "address", void 0);
__decorate([
    typeorm_1.PrimaryGeneratedColumn({ type: 'int' }),
    __metadata("design:type", Number)
], User.prototype, "ref", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', 'unique': true, length: 88 }),
    __metadata("design:type", String)
], User.prototype, "signature", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], User.prototype, "mail", void 0);
__decorate([
    typeorm_1.Column({ type: 'int', length: 3, 'default': 0 }),
    __metadata("design:type", Number)
], User.prototype, "wallet_id", void 0);
__decorate([
    typeorm_1.Column({ type: 'int', length: 11, 'default': 0 }),
    __metadata("design:type", Number)
], User.prototype, "used_ref", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], User.prototype, "firstname", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], User.prototype, "surname", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], User.prototype, "street", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 5 }),
    __metadata("design:type", String)
], User.prototype, "house_number", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], User.prototype, "location", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 9 }),
    __metadata("design:type", String)
], User.prototype, "zip", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 3 }),
    __metadata("design:type", String)
], User.prototype, "country", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 15 }),
    __metadata("design:type", String)
], User.prototype, "phone_number", void 0);
User = __decorate([
    typeorm_1.Entity()
], User);
exports.User = User;
//# sourceMappingURL=user.entity.js.map