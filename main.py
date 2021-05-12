# TODO
# Check bei Post Methode ob die Datenstruktur passt
# Fehlermeldungen (Response usw.)
# eigenen Ref code erstellen falls noch nicht vorhanden
#
# anstatts lokalhost -> api.fiat2defi.ch/


import ssl
import pymongo

from bson.json_util import dumps
from flask import abort
from flask import request, Flask, jsonify

app = Flask(__name__)

# Connect to mongoDB
client = pymongo.MongoClient(
    "mongodb+srv://apiuser:apiuser@defiexchange.cihof.mongodb.net/defiexchange?retryWrites=true&w=majority",
    ssl_cert_reqs=ssl.CERT_NONE)


# Get user information
@app.route('/userInformation', methods=['GET'])
def getUserInformation():
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    db = client['defiexchange']
    coll = db['customers']
    return dumps(coll.find_one({"address": legacyAddress}), indent=2)


# Get account history
@app.route('/accountHistory', methods=['GET'])
def getTransactionsHistory():
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    db = client['defiexchange']
    trans = db['transactions']
    return dumps(trans.find_one({"address": legacyAddress}), indent=2)


# Get all user information
@app.route('/allUserInformation', methods=['GET'])
def getAllUserInformation():
    query_parameters = request.args
    auth = query_parameters.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) is not None:
        db = client['defiexchange']
        coll = db['customers']
        return dumps(coll.find({}), indent=2)
    else:
        abort(400)


# Get all account history
@app.route('/allAccountHistory', methods=['GET'])
def getAllTransactionsHistory():
    query_parameters = request.args
    auth = query_parameters.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) is not None:
        db = client['defiexchange']
        coll = db['transactions']
        return dumps(coll.find({}), indent=2)
    else:
        abort(400)


# Add transaction
@app.route('/newTransaction', methods=['POST'])
def insertTransaction():
    if not request.json or not 'iban' in request.json:
        abort(400)
    db = client['defiexchange']
    coll = db['transactions']
    coll.insert_one(request.json)
    return jsonify({'success': "true"}), 201


app.run()
