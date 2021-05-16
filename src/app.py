# TODO
# Fehlermeldungen (Response usw.)
# Update anstatts delete und insert
# Doku anzeigen lassen (swagger.json oder yaml)
# Auth in den Authorization Header
# Suchen aller wallet Registrations findet er nur eine ggf. trans.find_one zu find_all?
# User information zeigt er immer eine an obwohl noch kein Eintrag in der Datenbank ist

import dash
import dash_html_components as html


import ssl
import pymongo

from bson.json_util import dumps
from flask import abort
from flask import request, Flask, jsonify
from datetime import datetime

intro = [html.H1('API description')]
descAllUsersAPI = [html.P([html.A('1. API to get all Users in database:'),
                           html.Br(),
                           html.A('/api/v1/allUsers',href="/api/v1/allUsers")])]

descUserInfoAPI = [html.P([html.A('2. API to get information of one specific User:'),
                           html.Br(),
                           html.A('additional parameters in Format ?legacyAddress=XYZ&signature=SIG needed'),
                           html.Br(),
                           html.A('/api/v1/userInformation',href="/api/v1/userInformation?legacyAddress=XYZ&signature=SIG")])]

descAllRegistrationsInfoAPI = [html.P([html.A('3. API to get all Registrations of all Users:'),
                                       html.Br(),
                                       html.A('/api/v1/allRegistrations',href="/api/v1/allRegistrations")])]

descWalletRegistrationsInfoAPI = [html.P([html.A('4. API to get all Registrations of one specific User:'),
                                          html.Br(),
                                          html.A('additional parameter in Format ?legacyAddress=XYZ needed'),
                                          html.Br(),
                                          html.A('/api/v1/registrations',href="/api/v1/registrations?legacyAddress=XYZ")])]

descAddRegistrationInfoAPI = [html.P([html.A('5. API to post new Registration of one specific User:'),
                                      html.Br(),
                                      html.A('additional parameters in Format ?legacyAddress=XYZ&signature=SIG needed'),
                                      html.Br(),
                                      html.A('/api/v1/addRegistration',href="/api/v1/addRegistration?legacyAddress=XYZ&signature=SIG")])]




app = dash.Dash()
app.layout =html.Div(intro + descAllUsersAPI + descUserInfoAPI + descAllRegistrationsInfoAPI + descWalletRegistrationsInfoAPI + descAddRegistrationInfoAPI)

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
@app.server.route('/api/v1/registrations', methods=['GET'])
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
        abort(404, 'No registrations with requested legacy address found!')

# Add Registration
@app.server.route('/api/v1/addRegistration', methods=['POST'])
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
@app.server.route('/api/v1/allUsers', methods=['GET'])
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

# Get all Registrations
@app.server.route('/api/v1/allRegistrations', methods=['GET'])
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

if __name__ == "__main__":
    app.run_server(debug=False)
