# TODO
# Fehlermeldungen (Response usw.)
# Update anstatts delete und insert
# Doku anzeigen lassen (swagger.json oder yaml)
# anstatts lokalhost -> api.fiat2defi.ch/
# Auth in den Authorization Header

import ssl
import pymongo

from bson.json_util import dumps
from flask import abort
from flask import request, Flask, jsonify
from datetime import datetime

app = Flask(__name__)

# Connect to mongoDB
client = pymongo.MongoClient(
    "mongodb+srv://apiuser:apiuser@defiexchange.cihof.mongodb.net/defiexchange?retryWrites=true&w=majority",
    ssl_cert_reqs=ssl.CERT_NONE)

# Get user information
@app.route('/api/v1/userInformation', methods=['GET'])
def getUserInformation():
    """Returns all user information from legacy address"""
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    signature = query_parameters.get('signature')
    mail = query_parameters.get('mail')
    kyc = query_parameters.get('kyc')
    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    if signature is None:
        abort(400, 'Signature is missing')
    db = client['defiexchange']
    coll = db['users']
    user =coll.find_one({"address": legacyAddress})
    if user is not None:
        if mail is not None: user["mail"] = mail
        if kyc is not None:  user["kyc"] = kyc
        coll.delete_one({"address": legacyAddress})
        coll.insert_one(user)
        return dumps(coll.find_one({"address": legacyAddress}), indent=2)
    else:
        newUser = {}
        newUser["address"] = legacyAddress
        newUser["signature"] = signature
        if mail is not None: newUser["mail"] = mail
        if kyc is not None:  newUser["kyc"] = kyc
        admin = db['admin']
        current_ref = admin.find_one({"field": "ref"})
        newUser["own_ref"] = current_ref["current_ref"]
        ref_int = int(current_ref["current_ref"]) +1
        current_ref["current_ref"] = str(ref_int)
        admin.delete_one({"field": "ref"})
        admin.insert_one(current_ref)
        coll.insert_one(newUser)

        return dumps(newUser, indent=2)

# Get wallet registrations
@app.route('/api/v1/registrations', methods=['GET'])
def getTransactionsHistory():
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    db = client['defiexchange']
    trans = db['registations']
    if trans.find_one({"address": legacyAddress}) is not None:
        return dumps(trans.find_one({"address": legacyAddress}), indent=2)
    else:
        abort(404, 'No registration with requested legacy address found!')

# Add transaction
@app.route('/api/v1/addRegistration', methods=['POST'])
def addRegistration():
    badFormat = 0
    message = 'Following data are missing:'
    if not request.json:
        abort(404, 'Data is no JSon')
    if not 'address' in request.json:
        message += ', address '
        badFormat = 1
    if not 'iban' in request.json:
        message += ', iban '
        badFormat = 1
    if not 'wallet_id' in request.json:
        message += ', wallet_id '
        badFormat = 1
    if not 'used_ref' in request.json:
        message += ', used_ref '
        badFormat = 1
    if not 'asset' in request.json:
        message += ', asset '
        badFormat = 1
    if not 'fiat' in request.json:
        message += ', fiat '
        badFormat = 1
    if badFormat == 1:
        abort(404, message)

    now = datetime.now()
    dateAndTime = now.strftime("%d/%m/%Y %H:%M:%S")

    request.json['timestamp'] = dateAndTime
    db = client['defiexchange']
    coll = db['registations']
    coll.insert_one(request.json)
    return jsonify({'success': "true"}), 201

# Get all user information
@app.route('/api/v1/allUsers', methods=['GET'])
def getUsers():
    query_parameters = request.args
    auth = query_parameters.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) is not None:
        db = client['defiexchange']
        coll = db['users']
        return dumps(coll.find({}), indent=2)
    else:
        abort(401, 'Unauthorized')

# Get all account history
@app.route('/api/v1/allRegistrations', methods=['GET'])
def getRegistrations():
    query_parameters = request.args
    auth = query_parameters.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) is not None:
        db = client['defiexchange']
        coll = db['registations']
        return dumps(coll.find({}), indent=2)
    else:
        abort(401, 'Unauthorized')

app.run()
