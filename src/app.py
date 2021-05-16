# TODO
# Doku anzeigen lassen (swagger.json oder yaml)
# Tabelle Transaktionen -> Fehlt noch was @Robin?
# Transaktionsgebühren: legacy adresse, signatur, wallet id? -> Robin?
# UpdateServer secret + GitHub webhooks
import dash
import dash_html_components as html
import ssl
import pymongo
import git

from bson.json_util import dumps
from flask import abort
from flask import request, jsonify
from datetime import datetime

intro = [html.H1('API description')]
#descAllUsersAPI = [html.P([html.A('API to get all Users in database:'),
#                           html.Br(),
#                           html.A('/api/v1/allUsers',href="/api/v1/allUsers")])]

descUserInfoAPI = [html.P([html.A('API to get information of one specific User:'),
                           html.Br(),
                           html.A('additional parameters in Format ?legacyAddress=XYZ&signature=SIG&IP=xxx.xxx needed'),
                           html.Br(),
                           html.A('/api/v1/userInformation',href="/api/v1/userInformation?legacyAddress=XYZ&signature=SIG&ip=xxx.xxx")])]

#descAllRegistrationsInfoAPI = [html.P([html.A('API to get all Registrations of all Users:'),
#                                       html.Br(),
#                                       html.A('/api/v1/allRegistrations',href="/api/v1/allRegistrations")])]

descWalletRegistrationsInfoAPI = [html.P([html.A('API to get all Registrations of one specific User:'),
                                          html.Br(),
                                          html.A('additional parameter in Format ?legacyAddress=XYZ&IP=xxx.xxx needed'),
                                          html.Br(),
                                          html.A('/api/v1/registrations',href="/api/v1/registrations?legacyAddress=XYZ")])]

descAddRegistrationInfoAPI = [html.P([html.A('API to post new Registration of one specific User:'),
                                      html.Br(),
                                      html.A('additional parameters in Format ?legacyAddress=XYZ&signature=SIG needed'),
                                      html.Br(),
                                      html.A('/api/v1/addRegistration',href="/api/v1/addRegistration?legacyAddress=XYZ&signature=SIG")])]


app = dash.Dash()
app.layout =html.Div(intro  + descUserInfoAPI  + descWalletRegistrationsInfoAPI + descAddRegistrationInfoAPI)

# Connect to mongoDB
client = pymongo.MongoClient(
    "mongodb+srv://apiuser:apiuser@defiexchange.cihof.mongodb.net/defiexchange?retryWrites=true&w=majority",connect=False,
    ssl_cert_reqs=ssl.CERT_NONE)

# Get user information
@app.server.route('/api/v1/userInformation', methods=['GET'])
def getUserInformation():
    """Returns all user information from legacy address"""
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    signature = query_parameters.get('signature')
    mail = query_parameters.get('mail')
    kyc = query_parameters.get('kyc')
    ip = query_parameters.get('ip')

    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    if signature is None:
        abort(400, 'Signature is missing')
    if ip is None:
        abort(400,'IP is missing')
    db = client['defiexchange']
    coll = db['users']
    user =coll.find_one({"address": legacyAddress})

    if user is not None:
        if mail is not None and kyc is not None:
            coll.update_one({"address": legacyAddress}, {"$set": {"kyc": kyc, "mail": mail}})
        return dumps(coll.find_one({"address": legacyAddress}), indent=2)
    else:
        newUser = {}
        newUser["address"] = legacyAddress
        newUser["signature"] = signature
        newUser["IP"] = ip
        if mail is not None: newUser["mail"] = mail
        if kyc is not None:  newUser["kyc"] = kyc

        admin = db['admin']
        current_ref = admin.find_one({"field": "ref"})
        newUser["own_ref"] = current_ref["current_ref"]
        ref_int = int(current_ref["current_ref"]) +1
        current_ref["current_ref"] = str(ref_int)
        admin.update_one({"field": "ref"}, {"$set": {"current_ref": str(ref_int)}})
        coll.insert_one(newUser)

        return dumps(newUser, indent=2)

# Get wallet registrations
@app.server.route('/api/v1/registrations', methods=['GET'])
def getTransactionsHistory():
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    db = client['defiexchange']
    trans = db['registations']
    if trans.find({"address": legacyAddress}) is not None:
        return dumps(trans.find({"address": legacyAddress}), indent=2)
    else:
        abort(404, 'No registrations with requested legacy address found!')

# Add Registration
@app.server.route('/api/v1/addRegistration', methods=['POST'])
def addRegistration():
    db = client['defiexchange']
    coll = db['users']
    user = coll.find_one({"address":  request.json['address']})

    if user is  None:
        abort(404, "User not found")

    badFormat = 0
    message = 'Following data are missing:'
    if not request.json:
        abort(400, 'Data is no JSON')
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
        abort(400, message)

    #Create hash
    _licenseText = "Text"
    _hash = hash(_licenseText+request.json['fiat']+request.json['address'])
    request.json['hash'] = str(_hash)

    #Add timestamp
    now = datetime.now()
    dateAndTime = now.strftime("%d/%m/%Y %H:%M:%S")
    request.json['timestamp'] = dateAndTime
    db = client['defiexchange']
    coll = db['registations']

    if coll.find_one({'hash':_hash}) is None:
        coll.insert_one(request.json)
    return jsonify({'success': "true",'license_text':_licenseText,'hash':_hash}), 201

# Add/Update Transaction
@app.server.route('/api/v1/addTransaction', methods=['POST'])
def addTransactiom():
    query_parameters = request.args
    auth = query_parameters.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) is not None:

        db = client['defiexchange']
        coll = db['transactions']
        badFormat = 0
        message = 'Following data are missing:'
        if not request.json:
            abort(400, 'Data is no JSON')
        if not 'hash' in request.json:
            message += ', hash'
            badFormat = 1
        if not 'fiat' in request.json:
            message += ', fiat'
            badFormat = 1
        if not 'asset' in request.json:
            message += ', asset'
            badFormat = 1
        if not 'amount' in request.json:
            message += ', amount'
            badFormat = 1
        if not 'fiat_timestamp' in request.json:
            message += ', fiat_timestamp'
            badFormat = 1
        if not 'asset_timestamp' in request.json:
            message += ', asset_timestamp'
            badFormat = 1
        if not 'txid' in request.json:
            message += ', txid'
            badFormat = 1
        if badFormat == 1:
            abort(400, message)

        transaction = coll.find_one({"hash": request.json['hash']})

        if transaction is None:

            now = datetime.now()
            dateAndTime = now.strftime("%d/%m/%Y %H:%M:%S")

            request.json['timestamp'] = dateAndTime
            db = client['defiexchange']
            coll = db['transactions']
            coll.insert_one(request.json)
        else:
            now = datetime.now()
            dateAndTime = now.strftime("%d/%m/%Y %H:%M:%S")

            request.json['timestamp'] = dateAndTime
            db = client['defiexchange']
            coll = db['transactions']
            coll.update_one({"hash": request.json['hash']}, {"$set": {"hash": request.json['hash'], "fiat": request.json['fiat'],"asset": request.json['asset'],"amount": request.json['amount'],"fiat_timestamp": request.json['fiat_timestamp'],"asset_timestamp": request.json['asset_timestamp'],"txid": request.json['txid'],'timestamp': request.json['timestamp']}})

        return jsonify({'success': "true"}), 201
    else:
        abort(401, 'Unauthorized')


# Get all user information
@app.server.route('/api/v1/allUsers', methods=['GET'])
def getUsers():
    header = request.headers
    auth = header.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) is not None:
        db = client['defiexchange']
        coll = db['users']
        return dumps(coll.find({}), indent=2)
    else:
        abort(401, 'Unauthorized')

# Get all Registrations
@app.server.route('/api/v1/allRegistrations', methods=['GET'])
def getRegistrations():
    query_parameters = request.args
    auth = query_parameters.get('Auth')
    db = client['defiexchange']
    trans = db['admin']
    if trans.find_one({"oAuth": auth}) and auth is not None:
        db = client['defiexchange']
        coll = db['registations']
        return dumps(coll.find({}), indent=2)
    else:
        abort(401, 'Unauthorized')

# Update router
@app.server.route('/api/v1/update_server', methods=['POST'])
def webhook():
    if request.method == 'POST':
        repo = git.Repo('D:\\Projects\\api-fiat2defi_test')
        origin = repo.remotes.origin
        origin.pull()
        return 'Updated PythonAnywhere successfully', 200
    else:
        return 'Wrong event type', 400

if __name__ == "__main__":
    app.run_server(debug=False)
