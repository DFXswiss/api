import {
  GoodsCategory,
  GoodsType,
  MerchantCategory,
  StoreType,
} from 'src/subdomains/core/payment-link/enums/merchant.enum';
import {
  GoodsCategory as BinanceGoodsCategory,
  GoodsType as BinanceGoodsType,
  MerchantMCC as BinanceMerchantCategory,
  StoreType as BinanceStoreType,
} from './binance.dto';

export const GoodsTypeMap: { [t in GoodsType]: BinanceGoodsType } = {
  [GoodsType.TANGIBLE]: BinanceGoodsType.TangibleGoods,
  [GoodsType.VIRTUAL]: BinanceGoodsType.VirtualGoods,
};

export const GoodsCategoryMap: { [c in GoodsCategory]: BinanceGoodsCategory } = {
  [GoodsCategory.ELECTRONICS_COMPUTERS]: BinanceGoodsCategory.ElectronicsComputers,
  [GoodsCategory.BOOKS_MUSIC_MOVIES]: BinanceGoodsCategory.BooksMusicMovies,
  [GoodsCategory.HOME_GARDEN_TOOLS]: BinanceGoodsCategory.HomeGardenTools,
  [GoodsCategory.CLOTHES_SHOES_BAGS]: BinanceGoodsCategory.ClothesShoesBags,
  [GoodsCategory.TOYS_KIDS_BABY]: BinanceGoodsCategory.ToysKidsBaby,
  [GoodsCategory.AUTOMOTIVE_ACCESSORIES]: BinanceGoodsCategory.AutomotiveAccessories,
  [GoodsCategory.GAME_RECHARGE]: BinanceGoodsCategory.GameRecharge,
  [GoodsCategory.ENTERTAINMENT_COLLECTION]: BinanceGoodsCategory.EntertainmentCollection,
  [GoodsCategory.JEWELRY]: BinanceGoodsCategory.Jewelry,
  [GoodsCategory.DOMESTIC_SERVICE]: BinanceGoodsCategory.DomesticService,
  [GoodsCategory.BEAUTY_CARE]: BinanceGoodsCategory.BeautyCare,
  [GoodsCategory.PHARMACY]: BinanceGoodsCategory.Pharmacy,
  [GoodsCategory.SPORTS_OUTDOORS]: BinanceGoodsCategory.SportsOutdoors,
  [GoodsCategory.FOOD_GROCERY_HEALTH_PRODUCTS]: BinanceGoodsCategory.FoodGroceryHealthProducts,
  [GoodsCategory.PET_SUPPLIES]: BinanceGoodsCategory.PetSupplies,
  [GoodsCategory.INDUSTRY_SCIENCE]: BinanceGoodsCategory.IndustryScience,
  [GoodsCategory.OTHERS]: BinanceGoodsCategory.Others,
};

export const StoreTypeMap: { [s in StoreType]: BinanceStoreType } = {
  [StoreType.ONLINE]: BinanceStoreType.ONLINE,
  [StoreType.PHYSICAL]: BinanceStoreType.PHYSICAL,
  [StoreType.ONLINE_AND_PHYSICAL]: BinanceStoreType.ONLINE_AND_PHYSICAL,
};

export const MerchantCategoryMap: { [m in MerchantCategory]: BinanceMerchantCategory } = {
  [MerchantCategory.ACCOMMODATION_AND_FOOD_SERVICES]: BinanceMerchantCategory.AccommodationAndFoodServices,
  [MerchantCategory.ADMINISTRATIVE_SUPPORT_WASTE_MANAGEMENT]:
    BinanceMerchantCategory.AdministrativeSupportWasteManagement,
  [MerchantCategory.AGRICULTURE_FORESTRY_FISHING_HUNTING]: BinanceMerchantCategory.AgricultureForestryFishingHunting,
  [MerchantCategory.ARTS_ENTERTAINMENT_RECREATION]: BinanceMerchantCategory.ArtsEntertainmentRecreation,
  [MerchantCategory.CONSTRUCTION]: BinanceMerchantCategory.Construction,
  [MerchantCategory.BROKER]: BinanceMerchantCategory.Broker,
  [MerchantCategory.CRYPTO_ATM]: BinanceMerchantCategory.CryptoATM,
  [MerchantCategory.CRYPTO_MINING]: BinanceMerchantCategory.CryptoMining,
  [MerchantCategory.PROPRIETARY_CRYPTO_TRADERS]: BinanceMerchantCategory.ProprietaryCryptoTraders,
  [MerchantCategory.ALGORITHM_CRYPTO_TRADERS]: BinanceMerchantCategory.AlgorithmCryptoTraders,
  [MerchantCategory.P2P_MERCHANTS]: BinanceMerchantCategory.P2PMerchants,
  [MerchantCategory.OTHER_DIGITAL_ASSET_SERVICES_PROVIDER]: BinanceMerchantCategory.OtherDigitalAssetServicesProvider,
  [MerchantCategory.BANK]: BinanceMerchantCategory.Bank,
  [MerchantCategory.NON_BANK_FINANCIAL_INSTITUTION]: BinanceMerchantCategory.NonBankFinancialInstitution,
  [MerchantCategory.MONEY_SERVICES_BUSINESS_PAYMENT_SERVICE_PROVIDERS]:
    BinanceMerchantCategory.MoneyServicesBusinessPaymentServiceProviders,
  [MerchantCategory.FAMILY_OFFICE]: BinanceMerchantCategory.FamilyOffice,
  [MerchantCategory.PERSONAL_INVESTMENT_COMPANIES]: BinanceMerchantCategory.PersonalInvestmentCompanies,
  [MerchantCategory.SUPERANNUATION_FUND]: BinanceMerchantCategory.SuperannuationFund,
  [MerchantCategory.SOVEREIGN_WEALTH_FUND]: BinanceMerchantCategory.SovereignWealthFund,
  [MerchantCategory.INVESTMENT_FUNDS]: BinanceMerchantCategory.InvestmentFunds,
  [MerchantCategory.EDUCATIONAL_SERVICES]: BinanceMerchantCategory.EducationalServices,
  [MerchantCategory.BETTING]: BinanceMerchantCategory.Betting,
  [MerchantCategory.HEALTH_CARE_SOCIAL_ASSISTANCE]: BinanceMerchantCategory.HealthCareSocialAssistance,
  [MerchantCategory.INFORMATION]: BinanceMerchantCategory.Information,
  [MerchantCategory.GENERAL_WHOLESALERS]: BinanceMerchantCategory.GeneralWholesalers,
  [MerchantCategory.MANAGEMENT_OF_COMPANIES_ENTERPRISES]: BinanceMerchantCategory.ManagementOfCompaniesEnterprises,
  [MerchantCategory.PRECIOUS_STONES_PRECIOUS_METALS_DEALERS]:
    BinanceMerchantCategory.PreciousStonesPreciousMetalsDealers,
  [MerchantCategory.CRUDE_OIL_NATURAL_GAS_DEALERS]: BinanceMerchantCategory.CrudeOilNaturalGasDealers,
  [MerchantCategory.GENERAL_MANUFACTURING]: BinanceMerchantCategory.GeneralManufacturing,
  [MerchantCategory.MARIJUANA]: BinanceMerchantCategory.Marijuana,
  [MerchantCategory.MINING_EXTRACTION]: BinanceMerchantCategory.MiningExtraction,
  [MerchantCategory.PAWN_SHOPS]: BinanceMerchantCategory.PawnShops,
  [MerchantCategory.PROFESSIONAL_SERVICES]: BinanceMerchantCategory.ProfessionalServices,
  [MerchantCategory.SCIENTIFIC_TECHNICAL_SERVICES]: BinanceMerchantCategory.ScientificTechnicalServices,
  [MerchantCategory.PUBLIC_ADMINISTRATION]: BinanceMerchantCategory.PublicAdministration,
  [MerchantCategory.REAL_ESTATE_RENTAL_LEASING]: BinanceMerchantCategory.RealEstateRentalLeasing,
  [MerchantCategory.RETAIL_STORES_ELECTRONICS]: BinanceMerchantCategory.RetailStoresElectronics,
  [MerchantCategory.RETAIL_STORES_FB]: BinanceMerchantCategory.RetailStoresFB,
  [MerchantCategory.RETAIL_STORES_JEWELRY]: BinanceMerchantCategory.RetailStoresJewelry,
  [MerchantCategory.RETAIL_TRADE_OTHERS]: BinanceMerchantCategory.RetailTradeOthers,
  [MerchantCategory.SALE_OF_DRUGS_PHARMACEUTICAL_PRODUCTS]: BinanceMerchantCategory.SaleOfDrugsPharmaceuticalProducts,
  [MerchantCategory.TOBACCO]: BinanceMerchantCategory.Tobacco,
  [MerchantCategory.TRANSPORTATION_WAREHOUSING]: BinanceMerchantCategory.TransportationWarehousing,
  [MerchantCategory.UTILITIES]: BinanceMerchantCategory.Utilities,
  [MerchantCategory.OTHER_CRYPTO_WEB3_SERVICES]: BinanceMerchantCategory.OtherCryptoWeb3Services,
  [MerchantCategory.OTHER]: BinanceMerchantCategory.Other,
};
