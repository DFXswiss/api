import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlReason } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import {
  CryptoPaymentMethod,
  FiatPaymentMethod,
  PaymentMethod,
} from 'src/subdomains/supporting/payment/dto/payment-method.enum';

export enum EventType {
  CREATE_ACCOUNT = '$create_account',
  UPDATE_ACCOUNT = '$update_account',
  LOGIN = '$login',
  CREATE_ORDER = '$create_order',
  TRANSACTION = '$transaction',
  CHARGEBACK = '$chargeback',
}

export enum SiftAssetType {
  COIN = '$coin',
  COMMODITY = '$commodity',
  CRYPTO = '$crypto',
  FIAT = '$fiat',
  TOKEN = '$token',
  STOCK = '$stock',
  BOND = '$bond',
}

export enum PaymentType {
  CASH = '$cash',
  CHECK = '$check',
  CREDIT_CARD = '$credit_card',
  CRYPTO_CURRENCY = '$crypto_currency',
  DEBIT_CARD = '$debit_card',
  DIGITAL_WALLET = '$digital_wallet',
  ELECTRONIC_FUND_TRANSFER = '$electronic_fund_transfer',
  FINANCING = '$financing',
  GIT_CARD = '$gift_card',
  INVOICE = '$invoice',
  IN_APP_PURCHASE = '$in_app_purchase',
  MONEY_ORDER = '$money_order',
  POINTS = '$points',
  PREPAID_CARD = '$prepaid_card',
  STORE_CREDIT = '$store_credit',
  THIRD_PARTY_PROCESSOR = '$third_party_processor',
  VOUCHER = '$voucher',
  SEPA_CREDIT = '$sepa_credit',
  SEPA_INSTANT_CREDIT = '$sepa_instant_credit',
  SEPA_DIRECT_DEBIT = '$sepa_direct_debit',
  ACH_CREDIT = '$ach_credit',
  ACH_DEBIT = '$ach_debit',
  WIRE_CREDIT = '$wire_credit',
  WIRE_DEBIT = '$wire_debit',
}

export enum SiftDecisionSource {
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  AUTOMATED_RULE = 'AUTOMATED_RULE',
  CHARGEBACK = 'CHARGEBACK',
}

export enum PaymentGateway {
  ABRA = '$abra',
  ACAPTURE = '$acapture',
  ACCPET_BLUE = '$accpet_blue',
  ADYEN = '$adyen',
  AEROPAY = '$aeropay',
  AFEX = '$afex',
  AFFINIPAY = '$affinipay',
  AFFIPAY = '$affipay',
  AFFIRM = '$affirm',
  AFRIVOUCHER = '$afrivoucher',
  AFTERPAY = '$afterpay',
  AIRPAY = '$airpay',
  AIRWALLEX = '$airwallex',
  ALIPAY = '$alipay',
  ALIPAY_HK = '$alipay_hk',
  ALLPAGO = '$allpago',
  ALTAPAY = '$altapay',
  AMAZON_PAYMENTS = '$amazon_payments',
  AMBANK_FPX = '$ambank_fpx',
  AMEX_CHECKOUT = '$amex_checkout',
  ANDROID_IAP = '$android_iap',
  ANDROID_PAY = '$android_pay',
  APG = '$apg',
  APLAZO = '$aplazo',
  APPLE_IAP = '$apple_iap',
  APPLE_PAY = '$apple_pay',
  ARGUS = '$argus',
  ASIABILL = '$asiabill',
  ASTROPAY = '$astropay',
  ATRIUM = '$atrium',
  AU_KANTAN = '$au_kantan',
  AUTHORIZENET = '$authorizenet',
  AVANGATE = '$avangate',
  BALANCED = '$balanced',
  BANCODOBRASIL = '$bancodobrasil',
  BANCONTACT = '$bancontact',
  BANCOPLURAL = '$bancoplural',
  BANORTE = '$banorte',
  BANRISUL = '$banrisul',
  BANWIRE = '$banwire',
  BARCLAYS = '$barclays',
  BAYANPAY = '$bayanpay',
  BBCN = '$bbcn',
  BCB = '$bcb',
  BEANSTREAM = '$beanstream',
  BELFIUS = '$belfius',
  BEST_INC = '$best_inc',
  BILLDESK = '$billdesk',
  BILLPOCKET = '$billpocket',
  BITCASH = '$bitcash',
  BITGO = '$bitgo',
  BITPAY = '$bitpay',
  BIZUM = '$bizum',
  BLACKHAWK = '$blackhawk',
  BLIK = '$blik',
  BLINC = '$blinc',
  BLOCKCHAIN = '$blockchain',
  BLUEPAY = '$bluepay',
  BLUESNAP = '$bluesnap',
  BNP_PARIBAS = '$bnpparibas',
  BOACOMPRA = '$boacompra',
  BOB = '$bob',
  BOKU = '$boku',
  BOLD = '$bold',
  BOLETOBANCARIO = '$boletobancario',
  BOLTPAY = '$boltpay',
  BPAY = '$bpay',
  BRADESCO = '$bradesco',
  BRAINTRIE = '$braintree',
  BREAD = '$bread',
  BRIDGEPAY = '$bridgepay',
  BRITE = '$brite',
  BUCKAROO = '$buckaroo',
  BUCKZY = '$buckzy',
  CADC = '$cadc',
  CARDCONNECT = '$cardconnect',
  CARDKNOX = '$cardknox',
  CASHFREE = '$cashfree',
  CASHLESSO = '$cashlesso',
  CASHLIB = '$cashlib',
  CATCHBALL = '$catchball',
  CCBILL = '$ccbill',
  CCAVENUE = '$ccavenue',
  CEEVO = '$ceevo',
  CELLULANT = '$cellulant',
  CEPBANK = '$cepbank',
  CHAIN_COMMERCE = '$chain_commerce',
  CHASE_PAYMENTECH = '$chase_paymentech',
  CHECKALT = '$checkalt',
  CHECKOUTCOM = '$checkoutcom',
  CIELO = '$cielo',
  CIRCLE = '$circle',
  CITI = '$citi',
  CITIZEN = '$citizen',
  CITRUS_PAY = '$citrus_pay',
  CLEAR_JUNCTION = '$clear_junction',
  CLEARBRIDGE = '$clearbridge',
  CLEARSETTLE = '$clearsettle',
  CLEARCOMMERCE = '$clearcommerce',
  CLEVERBRIDGE = '$cleverbridge',
  CLOSE_BROTHERS = '$close_brothers',
  CLOUDPAYMENTS = '$cloudpayments',
  CODI = '$codi',
  COFINOGA = '$cofinoga',
  COINBASE = '$coinbase',
  COINDIRECT = '$coindirect',
  COINPAYMENTS = '$coinpayments',
  COLLECTOR = '$collector',
  COMMUNITY_BANK_TRANSFER = '$community_bank_transfer',
  COMMWEB = '$commweb',
  COMPROPAGO = '$compropago',
  CONCARDIS = '$concardis',
  CONEKTA = '$conekta',
  COPO = '$copo',
  CREDIT_UNION_ATLANTIC = '$credit_union_atlantic',
  CREDORAX = '$credorax',
  CREDSYSTEM = '$credsystem',
  CROSS_RIVER = '$cross_river',
  CUENTADIGITAL = '$cuentadigital',
  CULQI = '$culqi',
  CYBERSOURCE = '$cybersource',
  CRYPTOCAPITAL = '$cryptocapital',
  CRYPTOPAY = '$cryptopay',
  CURRENCYCLOUD = '$currencycloud',
  CUSTOMERS_BANK = '$customers_bank',
  D_BARAI = '$d_barai',
  DANA = '$dana',
  DAOPAY = '$daopay',
  DATACASH = '$datacash',
  DBS_PAYLAH = '$dbs_paylah',
  DCBANK = '$dcbank',
  DECTA = '$decta',
  DEBITWAY = '$debitway',
  DELTEC = '$deltec',
  DEMOCRACY_ENGINE = '$democracy_engine',
  DEUTSCHE_BANK = '$deutsche_bank',
  DIBS = '$dibs',
  DIGITAL_RIVER = '$digital_river',
  DIGITALPAY = '$digitalpay',
  DINERO_SERVICES = '$dinero_services',
  DIRECTA24 = '$directa24',
  DLOCAL = '$dlocal',
  DOCOMO = '$docomo',
  DOKU = '$doku',
  DOSPARA = '$dospara',
  DOTPAY = '$dotpay',
  DRAGONPAY = '$dragonpay',
  DREFTORPAY = '$dreftorpay',
  DWARKESH = '$dwarkesh',
  DWOLLA = '$dwolla',
  EBANX = '$ebanx',
  ECOMM_PAY = '$ecommpay',
  ECOPAYZ = '$ecopayz',
  EDENRED = '$edenred',
  EDGIL_PAYWAY = '$edgil_payway',
  EFECTY = '$efecty',
  EFT = '$eft',
  ELAVON = '$elavon',
  ELIPA = '$elipa',
  EMERCHANTPAY = '$emerchantpay',
  EMPCORP = '$empcorp',
  ENETS = '$enets',
  EPAY = '$epay',
  EPAYEU = '$epayeu',
  EPOCH = '$epoch',
  EPOSPAY = '$epospay',
  EPROCESSING_NETWORK = '$eprocessing_network',
  EPS = '$eps',
  ESITEF = '$esitef',
  ETANA = '$etana',
  EUTELLER = '$euteller',
  EVERYPAY = '$everypay',
  EWAY = '$eway',
  E_XACT = '$e_xact',
  FASTNETWORK = '$fastnetwork',
  FAT_ZEBRA = '$fat_zebra',
  FIDOR = '$fidor',
  FINIX = '$finix',
  FINMO = '$finmo',
  FINTOLA = '$fintola',
  FISERV = '$fiserv',
  FIRST_ATLANTIC_COMMERCE = '$first_atlantic_commerce',
  FIRST_DATA = '$first_data',
  FLEXEPIN = '$flexepin',
  FLEXITI = '$flexiti',
  FLUIDPAY = '$fluidpay',
  FLUTTERWAVE = '$flutterwave',
  FPX = '$fpx',
  FRICK = '$frick',
  FXPAYGATE = '$fxpaygate',
  G2APAY = '$g2apay',
  GALILEO = '$galileo',
  GCASH = '$gcash',
  GEOSWIFT = '$geoswift',
  GETNET = '$getnet',
  GIGADAT = '$gigadat',
  GIROPAY = '$giropay',
  GLOBALCOLLECT = '$globalcollect',
  GLOBAL_PAYMENTS = '$global_payments',
  GLOBAL_PAYWAYS = '$global_payways',
  GMO = '$gmo',
  GMOPG = '$gmopg',
  GOCARDLESS = '$gocardless',
  GOCOIN = '$gocoin',
  GOOGLE_PAY = '$google_pay',
  GOOGLE_WALLET = '$google_wallet',
  GRABPAY = '$grabpay',
  HANMI = '$hanmi',
  HAPPY_MONEY = '$happy_money',
  HAYHAY = '$hayhay',
  HDFC_FSSNET = '$hdfc_fssnet',
  HEIDELPAY = '$heidelpay',
  HIPAY = '$hipay',
  HUMM = '$humm',
  HYPERPAY = '$hyperpay',
  I2C = '$i2c',
  IBOK = '$ibok',
  IDEAL = '$ideal',
  IFTHENPAY = '$ifthenpay',
  IKAJOO = '$ikajo',
  INCOMM = '$incomm',
  INCORE = '$incore',
  INGENICO = '$ingenico',
  INGHOME_PAY = '$inghomepay',
  INOVAPAY = '$inovapay',
  INOVIO = '$inovio',
  INSTAMOJO = '$instamojo',
  INTERAC = '$interac',
  INTERNETSECURE = '$internetsecure',
  INTERSWITCH = '$interswitch',
  INTUIT_QUICKBOOKS_PAYMENTS = '$intuit_quickbooks_payments',
  IPAY = '$ipay',
  IPAY88 = '$ipay88',
  ISIGNTHIS = '$isignthis',
  ITAU = '$itau',
  ITELEBILL = '$itelebill',
  IUGU = '$iugu',
  IXOPAY = '$ixopay',
  IYZICO = '$iyzico',
  IZETTLE = '$izettle',
  JABONG = '$jabong',
  JATIS = '$jatis',
  JETON = '$jeton',
  JNFX = '$jnfx',
  JUSPAY = '$juspay',
  KAKAOPAY = '$kakaopay',
  KASH = '$kash',
  KBC = '$kbc',
  KDDI = '$kddi',
  KEVIN = '$kevin',
  KHIPU = '$khipu',
  KLARNA = '$klarna',
  KNET = '$knet',
  KOMOJU = '$komoju',
  KONBINI = '$konbini',
  KOPAY = '$kopay',
  KORAPAY = '$korapay',
  KUSHKI = '$kushki',
  LATAMGATEWAY = '$latamgateway',
  LATAMPASS = '$latampass',
  LAYBUY = '$laybuy',
  LEAN = '$lean',
  LEMONWAY = '$lemonway',
  LETZPAY = '$letzpay',
  LIFEMILES = '$lifemiles',
  LIMELIGHT = '$limelight',
  LINEPAY = '$linepay',
  LINK4PAY = '$link4pay',
  LOGON = '$logon',
  MADA = '$mada',
  MANGOPAY = '$mangopay',
  MASTERCARD_PAYMENT_GATEWAY = '$mastercard_payment_gateway',
  MASTERPASS = '$masterpass',
  MATERA = '$matera',
  MAXIPAGO = '$maxipago',
  MAXPAY = '$maxpay',
  MAYBANK = '$maybank',
  MCB = '$mcb',
  MEIKOPAY = '$meikopay',
  MERCADOPAGO = '$mercadopago',
  MERCHANT_ESOLUTIONS = '$merchant_esolutions',
  MERPAY = '$merpay',
  MFS = '$mfs',
  MIDTRANS = '$midtrans',
  MINERVA = '$minerva',
  MIRJEH = '$mirjeh',
  MOBILE_MONEY = '$mobile_money',
  MOCKPAY = '$mockpay',
  MODO = '$modo',
  MOIP = '$moip',
  MOLLIE = '$mollie',
  MOMOPAY = '$momopay',
  MONERIS_SOLUTIONS = '$moneris_solutions',
  MONEYGRAM = '$moneygram',
  MONOOVA = '$monoova',
  MOYASAR = '$moyasar',
  MPESA = '$mpesa',
  MUCHBETTER = '$muchbetter',
  MULTIBANCO = '$multibanco',
  MULTICAJA = '$multicaja',
  MULTIPLUS = '$multiplus',
  MVB = '$mvb',
  MYBANK = '$mybank',
  MYFATOORAH = '$myfatoorah',
  NANACO = '$nanaco',
  NANOPLAZO = '$nanoplazo',
  NARANJA = '$naranja',
  NAVERPAY = '$naverpay',
  NEOSURF = '$neosurf',
  NET_CASH = '$net_cash',
  NETBILLING = '$netbilling',
  NETREGISTRY = '$netregistry',
  NETELLER = '$neteller',
  NETWORK_FOR_GOOD = '$network_for_good',
  NHN_KCP = '$nhn_kcp',
  NICEPAY = '$nicepay',
  NGENIUS = '$ngenius',
  NMCRYPTGATE = '$nmcryptgate',
  NMI = '$nmi',
  NOBLE = '$noble',
  NOON_PAYMENTS = '$noon_payments',
  OCEAN = '$ocean',
  OGONE = '$ogone',
  OKPAY = '$okpay',
  OMCP = '$omcp',
  OMISE = '$omise',
  ONEBIP = '$onebip',
  OPAY = '$opay',
  OPENPAY = '$openpay',
  OPENPAYMX = '$openpaymx',
  OPTILE = '$optile',
  OPTIMAL_PAYMENTS = '$optimal_payments',
  OVO = '$ovo',
  OXXO = '$oxxo',
  PACYPAY = '$pacypay',
  PADDLE = '$paddle',
  PAGAR_ME = '$pagar_me',
  PAGO_EFECTIVO = '$pago_efectivo',
  PAGOEFECTIVO = '$pagoefectivo',
  PAGOFACIL = '$pagofacil',
  PAGSEGURO = '$pagseguro',
  PAIDY = '$paidy',
  PAPARA = '$papara',
  PAXUM = '$paxum',
  PAY_GARDEN = '$pay_garden',
  PAY_ZONE = '$pay_zone',
  PAY4FUN = '$pay4fun',
  PAYBRIGHT = '$paybright',
  PAYCASE = '$paycase',
  PAYCASH = '$paycash',
  PAYCO = '$payco',
  PAYCELL = '$paycell',
  PAYDO = '$paydo',
  PAYDOO = '$paydoo',
  PAYEASE = '$payease',
  PAYEASY = '$payeasy',
  PAYEER = '$payeer',
  PAYEEZY = '$payeezy',
  PAYFAST = '$payfast',
  PAYFIX = '$payfix',
  PAYFLOW = '$payflow',
  PAYFORT = '$payfort',
  PAYGARDEN = '$paygarden',
  PAYGATE = '$paygate',
  PAYGENT = '$paygent',
  PAGO24 = '$pago24',
  PAGSMILE = '$pagsmile',
  PAY2 = '$pay2',
  PAYAID = '$payaid',
  PAYFUN = '$payfun',
  PAYIX = '$payix',
  PAYJP = '$payjp',
  PAYJUNCTION = '$payjunction',
  PAYKUN = '$paykun',
  PAYKWIK = '$paykwik',
  PAYLIKE = '$paylike',
  PAYMAYA = '$paymaya',
  PAYMEE = '$paymee',
  PAYMENTEZ = '$paymentez',
  PAYMENTOS = '$paymentos',
  PAYMENTWALL = '$paymentwall',
  PAYMENT_EXPRESS = '$payment_express',
  PAYMILL = '$paymill',
  PAYNL = '$paynl',
  PAYONE = '$payone',
  PAYONEER = '$payoneer',
  PAYOP = '$payop',
  PAYPAL = '$paypal',
  PAYPAL_EXPRESS = '$paypal_express',
  PAYPAY = '$paypay',
  PAYPER = '$payper',
  PAYPOST = '$paypost',
  PAYSAFE = '$paysafe',
  PAYSAFECARD = '$paysafecard',
  PAYSERA = '$paysera',
  PAYSIMPLE = '$paysimple',
  PAYSSION = '$payssion',
  PAYSTACK = '$paystack',
  PAYSTATION = '$paystation',
  PAYSTRAX = '$paystrax',
  PAYTABS = '$paytabs',
  PAYTM = '$paytm',
  PAYTRACE = '$paytrace',
  PAYTRAIL = '$paytrail',
  PAYSTRUST = '$paystrust',
  PAYTRUST = '$paytrust',
  PAYTURE = '$payture',
  PAYWAY = '$payway',
  PAYU = '$payu',
  PAYULATAM = '$payulatam',
  PAYVALIDA = '$payvalida',
  PAYVECTOR = '$payvector',
  PAYZA = '$payza',
  PAYZEN = '$payzen',
  PEACH_PAYMENTS = '$peach_payments',
  PEP = '$pep',
  PERFECT_MONEY = '$perfect_money',
  PERLA_TERMINALS = '$perla_terminals',
  PICPAY = '$picpay',
  PINPAYMENTS = '$pinpayments',
  PIVOTAL_PAYMENTS = '$pivotal_payments',
  PIX = '$pix',
  PLAID = '$plaid',
  PLANET_PAYMENT = '$planet_payment',
  PLUGANDPLAY = '$plugandplay',
  POLI = '$poli',
  POSCONNECT = '$posconnect',
  PPRO = '$ppro',
  PRIMETRUST = '$primetrust',
  PRINCETON_PAYMENT_SOLUTIONS = '$princeton_payment_solutions',
  PRISMA = '$prisma',
  PRISMPAY = '$prismpay',
  PROCESSING = '$processing',
  PRZELEWY24 = '$przelewy24',
  PSIGATE = '$psigate',
  PUBALI_BANK = '$pubali_bank',
  PULSE = '$pulse',
  PWMB = '$pwmb',
  QIWI = '$qiwi',
  QR_CODE_BT = '$qr_code_bt',
  QUADPAY = '$quadpay',
  QUAIFE = '$quaife',
  QUICKPAY = '$quickpay',
  QUICKSTREAM = '$quickstream',
  QUIKIPAY = '$quikipay',
  RABERIL = '$raberil',
  RADIAL = '$radial',
  RAILS_BANK = '$railsbank',
  RAKBANK = '$rakbank',
  RAKUTEN_CHECKOUT = '$rakuten_checkout',
  RAPID_PAYMENTS = '$rapid_payments',
  RAPIPAGO = '$rapipago',
  RAPPIPAY = '$rappipay',
  RAPYD = '$rapyd',
  RATEPAY = '$ratepay',
  RAVEPAY = '$ravepay',
  RAZORPAY = '$razorpay',
  RBKMONEY = '$rbkmoney',
  REACH = '$reach',
  RECURLY = '$recurly',
  RED_DOT_PAYMENT = '$red_dot_payment',
  REDE = '$rede',
  REDPAGOS = '$redpagos',
  REDSYS = '$redsys',
  REWARDSPAY = '$rewardspay',
  RIETUMU = '$rietumu',
  RIPPLE = '$ripple',
  ROCKETGATE = '$rocketgate',
  SAFECHARGE = '$safecharge',
  SAFETYPAY = '$safetypay',
  SAFEXPAY = '$safexpay',
  SAGEPAY = '$sagepay',
  SALTEDGE = '$saltedge',
  SAMSUNG_PAY = '$samsung_pay',
  SANDBOX = '$sandbox',
  SANTANDER = '$santander',
  SAOUDI_PAY = '$saoudi_pay',
  SAPAYOL = '$sapayol',
  SATSBACK = '$satsback',
  SBERBANK = '$sberbank',
  SCROLLBACK = '$scrollback',
  SEATTLE_BANK = '$seattle_bank',
  SECUREPAY = '$securepay',
  SECURETRADING = '$securetrading',
  SEGMOPAY = '$segmopay',
  SELLERACTIVE = '$selleractive',
  SENDO = '$sendo',
  SEQR = '$seqr',
  SERVEBASE = '$servebase',
  SETCOM = '$setcom',
  SEVEN_BANK = '$seven_bank',
  SEZZLE = '$sezzle',
  SHIFT4 = '$shift4',
  SHOPIFY_PAYMENTS = '$shopify_payments',
  SIAM_COMMERCIAL_BANK = '$siam_commercial_bank',
  SIBS = '$sibs',
  SILEX = '$silex',
  SIMPLEX = '$simplex',
  SIRU_MOBILE = '$siru_mobile',
  SIX_PAY = '$six_pay',
  SKRILL = '$skrill',
  SKYRUNNER = '$skyrunner',
  SMART2PAY = '$smart2pay',
  SMARTCASH = '$smartcash',
  SMARTBILL = '$smartbill',
  SMARTPAY = '$smartpay',
  SMOOV = '$smoov',
  SNAPCARD = '$snapcard',
  SOFORT = '$sofort',
  SOLIDTRUST_PAY = '$solidtrust_pay',
  SOLU_PAY = '$solu_pay',
  SONY_PAY = '$sony_pay',
  SOSEL = '$sosel',
  SPARK_PAY = '$spark_pay',
  SPAY = '$spay',
  SPEEDPAY = '$speedpay',
  SPIKE = '$spike',
  SPINPAY = '$spinpay',
  SPLITIT = '$splitit',
  SPOTII = '$spotii',
  SPOTON = '$spoton',
  SQUARE = '$square',
  SQUAREUP = '$squareup',
  STAKEMONEY = '$stakemoney',
  STARPAY = '$starpay',
  STRIPE = '$stripe',
  STRIPE_PAYMENTS = '$stripe_payments',
  STRIPE_RADAR = '$stripe_radar',
  STRIPE_CONNECT = '$stripe_connect',
  STRIPE_SUBSCRIPTIONS = '$stripe_subscriptions',
  STRONGHOLD = '$stronghold',
  STYX_PAY = '$styx_pay',
  SUMUP = '$sumup',
  SUNNY_BANK = '$sunny_bank',
  SUNTEC = '$suntec',
  SWIFT_CASH = '$swift_cash',
  SWIPE = '$swipe',
  SWITCH = '$switch',
  SWOOP = '$swoop',
  SWYFT = '$swyft',
  TALLYPAY = '$tallypay',
  TAMARA = '$tamara',
  TAP = '$tap',
  TA_P2P = '$ta_p2p',
  TAP2PAY = '$tap2pay',
  TAP_N_GO = '$tap_n_go',
  TARJETA_NARANJA = '$tarjeta_naranja',
  TATA = '$tata',
  TC_PAY = '$tc_pay',
  TCREDIT = '$tcredit',
  TECS = '$tecs',
  TELEPAY = '$telepay',
  TELERED = '$telered',
  TELEREAL = '$telereal',
  TENPAY = '$tenpay',
  TENTAM = '$tentam',
  TETHER = '$tether',
  THAILAND_BANK = '$thailand_bank',
  THE_EXCHANGE = '$the_exchange',
  THETIE = '$thetie',
  THETRUST = '$thetrust',
  TIKITAKA = '$tikitaka',
  TO_PAY = '$to_pay',
  TODITO_CASH = '$todito_cash',
  TODOPAGO = '$todopago',
  TOPPAY = '$toppay',
  TOUCH_N_GO = '$touch_n_go',
  TRANZILA = '$tranzila',
  TRAVELEX = '$travelex',
  TRU_PAYMENTS = '$tru_payments',
  TRUE_MONEY = '$true_money',
  TRUSTLY = '$trustly',
  TURKISH_BANK = '$turkish_bank',
  TWO_CHECKOUT = '$two_checkout',
  TYG = '$tyg',
  UATP = '$uatp',
  UBANK = '$ubank',
  UBILL = '$ubill',
  UCARD = '$ucard',
  UCO = '$uco',
  UKASH = '$ukash',
  UKRSIBBANK = '$ukrsibbank',
  UMBRACO = '$umbraco',
  UMBRELLA = '$umbrella',
  UNIFIED_PAYMENTS = '$unified_payments',
  UNION_PAY = '$union_pay',
  UNIPAGOS = '$unipagos',
  UNIPAY = '$unipay',
  UNITPAY = '$unitpay',
  UNIWELL = '$uniwell',
  UNPAY = '$unpay',
  UPI = '$upi',
  UPOP = '$upop',
  UPS = '$ups',
  UPSTOX = '$upstox',
  UPTOBOX = '$uptobox',
  USP = '$usp',
  UTILITY_WAREHOUSE = '$utility_warehouse',
  UTMOBILE = '$utmobile',
  UTPAY = '$utpay',
  VALITOR = '$valitor',
  VANTIV = '$vantiv',
  VARO_PAY = '$varo_pay',
  VENDO = '$vendo',
  VENMO = '$venmo',
  VERICHEQ = '$vericheq',
  VERIFONE = '$verifone',
  VERIFONE_EURONET = '$verifone_euronet',
  VERIFONE_VX520 = '$verifone_vx520',
  VERIPAY = '$veripay',
  VISA_CHECKOUT = '$visa_checkout',
  VISA_MASTER_CARD = '$visa_master_card',
  VIRTUAL_CARD_SERVICES = '$virtual_card_services',
  VIRTUALCASH = '$virtualcash',
  VIRTUEMART = '$virtuemart',
  VISA = '$visa',
  VISANET = '$visanet',
  VIVE_MONOPOLY = '$vive_monopoly',
  VK_PAY = '$vk_pay',
  VME = '$vme',
  VOLKSBANK = '$volksbank',
  VOUCHER = '$voucher',
  VUBIQUITY = '$vubiquity',
  WALGREENS = '$walgreens',
  WALLET = '$wallet',
  WALLETMOBI = '$walletmobi',
  WALMART = '$walmart',
  WANZOA = '$wanzoa',
  WEPAY = '$wepay',
  WESTERN_UNION = '$western_union',
  WESTPAC = '$westpac',
  WIRED_PAYMENTS = '$wired_payments',
  WIRECARD = '$wirecard',
  WISE = '$wise',
  WISEPAY = '$wisepay',
  WIZZIT = '$wizzit',
  WORLDNET = '$worldnet',
  WORLDLINE = '$worldline',
  WORLDPAY = '$worldpay',
  WORLDPAY_MY = '$worldpay_my',
  WORLDPAY_UK = '$worldpay_uk',
  WORLREMIT = '$worlremit',
  WPRKFLOWMAX = '$wprkflowmax',
  WU_PAY = '$wu_pay',
  WYRE = '$wyre',
  XPAYMENTS = '$xpayments',
  XPAYMENTSSDK = '$xpaymentssdk',
  XPAYZ = '$xpayz',
  YANDEX_MONEY = '$yandex_money',
  YAPPAY = '$yappay',
  YOOMONEY = '$yoomoney',
  ZAAKPAY = '$zaakpay',
  ZALOPAY = '$zalopay',
  ZAPP = '$zapp',
  ZCASH = '$zcash',
  ZELLE = '$zelle',
  ZENITH_BANK = '$zenith_bank',
  ZHIFUBAO = '$zhifubao',
  ZIMPLER = '$zimpler',
  ZOTAPAY = '$zotapay',
  ZTICKET = '$zticket',
  ZTOT = '$ztot',
  ZWYPAY = '$zwypay',
}

export enum TransactionType {
  SALE = '$sale',
  AUTHORIZE = '$authorize',
  CAPTURE = '$capture',
  VOID = '$void',
  REFUND = '$refund',
  DEPOSIT = '$deposit',
  WITHDRAWAL = '$withdrawal',
  TRANSFER = '$transfer',
  BUY = '$buy',
  SELL = '$sell',
  SEND = '$send',
  RECEIVE = '$receive',
}

export enum TransactionStatus {
  SUCCESS = '$success',
  FAILURE = '$failure',
  PENDING = '$pending',
}

export enum DeclineCategory {
  FRAUD = '$fraud',
  LOST_OR_STOLEN = '$lost_or_stolen',
  RISKY = '$risky',
  BANK_DECLINE = '$bank_decline',
  INVALID = '$invalid',
  EXPIRED = '$expired',
  INSUFFICIENT_FUNDS = '$insufficient_funds',
  LIMIT_EXCEEDED = '$limit_exceeded',
  ADDITIONAL_VERIFICATION_REQUIRED = '$additional_verification_required',
  INVALID_VERIFICATION = '$invalid_verification',
  OTHER = '$other',
}

export interface SiftDecision {
  decision_id: string;
  source: SiftDecisionSource;
  analyst: string;
  description?: string;
  time?: number;
}

export interface SiftBase {
  $type?: EventType;
  $api_key?: string;
  $user_id?: string;
  $ip?: string;
  $time?: number;
}

export interface CreateAccount extends SiftBase {
  $session_id?: string;
  $user_email?: string;
  $verification_phone_number?: string;
  $name?: string;
  $phone?: string;
  $referrer_user_id?: string;
  $brand_name?: string;
  $site_country?: string;
  $payment_methods?: [
    {
      $payment_type?: string;
      $card_bin?: string;
      $card_last4?: string;
    },
  ];
  $billing_address?: {
    $name?: string;
    $phone?: string;
    $address_1?: string;
    $address_2?: string;
    $city?: string;
    $region?: string;
    $country?: string;
    $zipcode?: string;
  };
  $shipping_address?: {
    $name?: string;
    $phone?: string;
    $address_1?: string;
    $address_2?: string;
    $city?: string;
    $region?: string;
    $country?: string;
    $zipcode?: string;
  };
  $promotions?: [
    {
      $promotion_id?: string;
      $status?: string;
      $referrer_user_id?: string;
      $credit_point?: {
        $amount?: number;
        $credit_point_type?: string;
      };
    },
  ];

  $social_sign_on_type?: string;
  $account_types?: [string];

  twitter_handle?: string;
  work_phone?: string;
  location?: string;
  referral_code?: string;
  email_confirmed_status?: string;
  phone_confirmed_status?: string;

  $browser?: {
    $user_agent?: string;
    $accept_language?: string;
    $content_language?: string;
  };

  $app?: {
    $os?: string;
    $os_version?: string;
    $device_manufacturer?: string;
    $device_model?: string;
    $device_unique_id?: string;
    $app_name?: string;
    $app_version?: string;
    $client_language?: string;
  };

  // custom fields
  blockchain_address?: string;
  kyc_level?: number;
}

export interface DigitalOrder {
  $digital_asset?: string;
  $pair?: string;
  $asset_type?: string;
  $order_type?: string;
  $volume?: string;
}

export interface CreateOrder extends SiftBase {
  $order_id?: string;
  $user_email?: string;
  $amount?: number;
  $currency_code?: string;
  $brand_name?: string;
  $site_country?: string;
  $payment_methods?: [
    {
      $payment_type?: PaymentType;
      $payment_gateway?: PaymentGateway;
      $card_bin?: string;
      $card_last4?: string;
    },
  ];
  $routing_number?: string;
  $shortened_iban_first6?: string;
  $shortened_iban_last4?: string;
  $account_number_last5?: string;
  $bank_name?: string;
  $bank_country?: string;
  $digital_orders?: DigitalOrder[];

  // custom fields
  blockchain: Blockchain;
}

export interface Transaction extends SiftBase {
  $amount?: number;
  $currency_code?: string;
  $transaction_type?: TransactionType;
  $transaction_status?: TransactionStatus;
  $decline_category?: DeclineCategory;
  $order_id?: string;
  $transaction_id?: string;
  $status_3ds?: string;
  $brand_name?: string;
  $site_country?: string;
  $payment_method?: {
    $payment_type?: PaymentType;
    $payment_gateway?: PaymentGateway;
    $account_holder_name?: string;
    $card_bin?: string;
    $card_last4?: string;
    $shortened_iban_first6?: string;
    $shortened_iban_last4?: string;
    $bank_name?: string;
    $bank_country?: string;
    $routing_number?: string;
  };
  $digital_orders?: DigitalOrder[];

  // custom field
  blockchain?: Blockchain;
}

export interface Chargeback extends SiftBase {
  $order_id?: string;
  $transaction_id?: string;
  $chargeback_state?: ChargebackState;
  $chargeback_reason?: ChargebackReason;
}

export enum ChargebackState {
  RECEIVED = '$received',
  ACCEPTED = '$accepted',
  DISPUTED = '$disputed',
  WON = '$won',
  LOST = '$lost',
}

export enum ChargebackReason {
  FRAUD = '$fraud',
  DUPLICATE = '$duplicate',
  PRODUCT_NOT_RECEIVED = '$product_not_received',
  PRODUCT_UNACCEPTABLE = '$product_unacceptable',
  OTHER = '$other',
  AUTHORIZATION = '$authorization',
  CONSUMER_DISPUTES = '$consumer_disputes',
  PROCESSING_ERRORS = '$processing_errors',
  CANCEL_SUBSCRIPTION = '$cancel_subscription',
  FRIENDLY_FRAUD = '$friendly_fraud',
  ACH_RETURN = '$ach_return',
  ACH_REVERSAL = '$ach_reversal',
}

export const SiftPaymentMethodMap: { [method in PaymentMethod]: PaymentType } = {
  [FiatPaymentMethod.BANK]: PaymentType.SEPA_CREDIT,
  [FiatPaymentMethod.INSTANT]: PaymentType.SEPA_INSTANT_CREDIT,
  [FiatPaymentMethod.CARD]: PaymentType.CREDIT_CARD,
  [CryptoPaymentMethod.CRYPTO]: PaymentType.CRYPTO_CURRENCY,
};

export const SiftCheckoutDeclineMap: { [method: string]: DeclineCategory } = {
  '01': DeclineCategory.INVALID_VERIFICATION,
  '02': DeclineCategory.OTHER,
  '03': DeclineCategory.OTHER,
  '04': DeclineCategory.LIMIT_EXCEEDED,
  '05': DeclineCategory.EXPIRED,
  '06': DeclineCategory.INVALID,
  '07': DeclineCategory.INVALID,
  '08': DeclineCategory.OTHER,
  '09': DeclineCategory.OTHER,
  '10': DeclineCategory.LOST_OR_STOLEN,
  '11': DeclineCategory.FRAUD,
  '12': DeclineCategory.OTHER,
  '13': DeclineCategory.OTHER,
  '14': DeclineCategory.OTHER,
  '15': DeclineCategory.OTHER,
  '16': DeclineCategory.OTHER,
  '17': DeclineCategory.OTHER,
  '18': DeclineCategory.OTHER,
  '19': DeclineCategory.OTHER,
  '20': DeclineCategory.OTHER,
  '21': DeclineCategory.OTHER,
  '22': DeclineCategory.OTHER,
  '23': DeclineCategory.OTHER,
  '24': DeclineCategory.OTHER,
  '25': DeclineCategory.OTHER,
  '26': DeclineCategory.OTHER,
  '80': DeclineCategory.OTHER,
  '81': DeclineCategory.OTHER,
  '82': DeclineCategory.OTHER,
  '83': DeclineCategory.OTHER,
  '84': DeclineCategory.OTHER,
  '85': DeclineCategory.OTHER,
  '86': DeclineCategory.OTHER,
  '87': DeclineCategory.OTHER,
  '88': DeclineCategory.OTHER,
  '89': DeclineCategory.OTHER,
  '90': DeclineCategory.OTHER,
};

export const SiftAmlDeclineMap: { [method in AmlReason]: DeclineCategory } = {
  [AmlReason.ANNUAL_LIMIT]: DeclineCategory.OTHER,
  [AmlReason.ANNUAL_LIMIT_WITHOUT_KYC]: DeclineCategory.OTHER,
  [AmlReason.ASSET_CURRENTLY_NOT_AVAILABLE]: DeclineCategory.INVALID,
  [AmlReason.ASSET_NOT_AVAILABLE_WITH_CHOSEN_BANK]: DeclineCategory.INVALID,
  [AmlReason.BANK_NOT_ALLOWED]: DeclineCategory.RISKY,
  [AmlReason.COUNTRY_NOT_ALLOWED]: DeclineCategory.RISKY,
  [AmlReason.MONTHLY_LIMIT]: DeclineCategory.OTHER,
  [AmlReason.FEE_TOO_HIGH]: DeclineCategory.OTHER,
  [AmlReason.HIGH_RISK_BLOCKED]: DeclineCategory.RISKY,
  [AmlReason.HIGH_RISK_KYC_NEEDED]: DeclineCategory.RISKY,
  [AmlReason.IBAN_CHECK]: DeclineCategory.OTHER,
  [AmlReason.KYC_REJECTED]: DeclineCategory.OTHER,
  [AmlReason.MANUAL_CHECK]: DeclineCategory.OTHER,
  [AmlReason.MANUAL_CHECK_BANK_DATA]: DeclineCategory.OTHER,
  [AmlReason.MIN_DEPOSIT_NOT_REACHED]: DeclineCategory.OTHER,
  [AmlReason.NA]: DeclineCategory.OTHER,
  [AmlReason.NAME_CHECK_WITHOUT_KYC]: DeclineCategory.OTHER,
  [AmlReason.NO_COMMUNICATION]: DeclineCategory.OTHER,
  [AmlReason.OLKY_NO_KYC]: DeclineCategory.OTHER,
  [AmlReason.RECEIVER_REJECTED_TX]: DeclineCategory.OTHER,
  [AmlReason.STAKING_DISCONTINUED]: DeclineCategory.INVALID,
  [AmlReason.USER_DATA_MISMATCH]: DeclineCategory.OTHER,
  [AmlReason.CHF_ABROAD_TX]: DeclineCategory.INVALID,
  [AmlReason.ASSET_KYC_NEEDED]: DeclineCategory.OTHER,
  [AmlReason.CARD_NAME_MISMATCH]: DeclineCategory.OTHER,
  [AmlReason.USER_BLOCKED]: DeclineCategory.OTHER,
  [AmlReason.USER_DATA_BLOCKED]: DeclineCategory.OTHER,
  [AmlReason.USER_DELETED]: DeclineCategory.OTHER,
  [AmlReason.VIDEO_IDENT_NEEDED]: DeclineCategory.OTHER,
  [AmlReason.MISSING_LIQUIDITY]: DeclineCategory.OTHER,
  [AmlReason.TEST_ONLY]: DeclineCategory.OTHER,
  [AmlReason.KYC_DATA_NEEDED]: DeclineCategory.OTHER,
  [AmlReason.BANK_TX_NEEDED]: DeclineCategory.OTHER,
  [AmlReason.MERGE_NOT_COMPLETED]: DeclineCategory.OTHER,
  [AmlReason.MANUAL_CHECK_PHONE]: DeclineCategory.RISKY,
};

export interface ScoreRsponse {
  status: number;
  error_message: string;
  scores: {
    score: number;
    percentiles: {
      last_1_day?: number;
      last_5_days?: number;
      last_7_days?: number;
      last_10_days?: number;
    };
    reasons: [{ name: string; value: string; details: any }];
  };
  user_id: string;
  latest_labels: {
    payment_abuse: ScoreAbuse;
    account_abuse: ScoreAbuse;
    content_abuse: ScoreAbuse;
    promotion_abuse: ScoreAbuse;
  };
  workflow_statuses: [SiftWorkflow];
}

export interface SiftResponse {
  status: number;
  error_message: string;
  request: string;
  time: number;
  score_response: ScoreRsponse;
}

export interface ScoreAbuse {
  is_fraud: boolean;
  time: number;
  description: string;
}

export interface SiftWorkflow {
  id: string;
  state: string;
  config: { id: string; version: string };
  config_display_name: string;
  abuse_types: string;
  entity: { type: string; id: string };
  history: [
    {
      app: string;
      name: string;
      state: string;
      config: { decision_id: string; buttions: [{ id: string; name: string }] };
    },
  ];
  route: { name: string };
}
