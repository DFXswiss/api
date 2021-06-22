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
exports.Sell = void 0;
const typeorm_config_1 = require("../config/typeorm.config");
const typeorm_1 = require("typeorm");
let Sell = class Sell {
};
__decorate([
    typeorm_1.PrimaryColumn({ type: 'varchar', unique: true, length: 42 }),
    __metadata("design:type", String)
], Sell.prototype, "id", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 34 }),
    __metadata("design:type", String)
], Sell.prototype, "address", void 0);
__decorate([
    typeorm_1.Column({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], Sell.prototype, "iban", void 0);
__decorate([
    typeorm_1.Column({ type: 'int', length: 3 }),
    __metadata("design:type", Number)
], Sell.prototype, "fiat", void 0);
__decorate([
    typeorm_1.Column({ type: 'int', unique: true, length: 11 }),
    __metadata("design:type", String)
], Sell.prototype, "deposit_id", void 0);
__decorate([
    typeorm_1.Column({ type: 'tinyint', length: 1, default: 1 }),
    __metadata("design:type", Boolean)
], Sell.prototype, "active", void 0);
Sell = __decorate([
    typeorm_1.Entity()
], Sell);
exports.Sell = Sell;
//# sourceMappingURL=sell.entity.js.map