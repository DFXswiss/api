from werkzeug.utils import redirect
from flask import jsonify
import mysql.connector
import sys
import hashlib
from flask import abort, request
from app import app
from src import config_file

@app.server.route("/")
@app.server.route("/index")
def index():
    return redirect("https://app.swaggerhub.com/apis-docs/meintest/Api-Fiat2Defichain/1")

#GET POST PUT User
@app.server.route('/api/v1/user/<address>', methods=["GET","POST"])
def getOrUpdateUser(address):

    query_parameters = request.args
    signature = query_parameters.get('signature').replace(" ","+")
    checkAddressAndSignature(address,signature)

    if request.method == 'GET':
        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users where address = %s and signature = %s"
        val = (address,signature)
        cur.execute(sql, val)
        rv = cur.fetchall()
        if len(rv) > 0:
            row_headers = [x[0] for x in cur.description]
            json_data = []
            for result in rv:
                json_data.append(dict(zip(row_headers, result)))
            json_data[0]['created'] = json_data[0]['created'].strftime("%Y-%m-%dT%H:%M:%S")
            return jsonify(json_data[0])
        else:
            abort(404, 'No User with that legacy address and signature found!')
    elif request.method == 'POST':

        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users where address = %s and signature = %s"
        val = (address,signature)
        cur.execute(sql, val)
        rv = cur.fetchall()
        json_data = []
        if len(rv) > 0:
            mail = request.json['mail']
            wallet_id =  request.json['wallet_id']
            used_ref = request.json['used_ref']
            ip = request.json['ip']
            row_headers = [x[0] for x in cur.description]
            for result in rv:
                json_data.append(dict(zip(row_headers, result)))
            json_data[0]['created'] = json_data[0]['created'].strftime("%Y-%m-%dT%H:%M:%S")
            if mail is not None and not isParameterSQL(mail):
                json_data[0]['mail'] = mail
                sql = "UPDATE users SET mail = %s WHERE address = %s"
                val = (mail, address)
                cur.execute(sql, val)
                conn.commit()
            if wallet_id is not None and not isParameterSQL(wallet_id):
                json_data[0]['wallet_id'] = int(wallet_id)
                sql = "UPDATE users SET wallet_id = %s WHERE address = %s"
                val = (wallet_id, address)
                cur.execute(sql, val)
                conn.commit()
            if used_ref is not None and not isParameterSQL(used_ref):
                json_data[0]['used_ref'] = int(used_ref)
                sql = "UPDATE users SET used_ref = %s WHERE address = %s"
                val = (used_ref, address)
                cur.execute(sql, val)
                conn.commit()
            if ip is not None and not isParameterSQL(ip):
                json_data[0]['ip'] = int(ip)
                sql = "UPDATE users SET ip = %s WHERE address = %s"
                val = (ip, address)
                cur.execute(sql, val)
                conn.commit()
        return jsonify(json_data[0])

#GET POST PUT User
@app.server.route('/api/v1/user', methods=["PUT"])
def addUser():

    checkAddressAndSignature(request.json['address'],request.json['signature'])
    newUser = {}
    newUser["address"] = request.json['address']
    mail = request.json['mail']
    wallet_id = request.json['wallet_id']
    used_ref = request.json['used_ref']
    ip = request.json['ip']
    executeString = "SELECT * FROM users"
    conn = createDBConnection()
    cur = conn.cursor()
    cur.execute(executeString)
    rv = cur.fetchall()
    ref_int = cur.rowcount
    newUser["ref"] = ref_int + 1
    newUser["signature"] = request.json['signature']
    if mail is not None and "@" in mail: newUser["mail"] = mail
    if wallet_id is not None: newUser["wallet_id"] = int(wallet_id)
    if used_ref is not None: newUser["used_ref"] = int(used_ref)
    newUser["IP"] = ip
    sql = "INSERT INTO users (address, ref, signature, IP) VALUES (%s, %s, %s, %s)"
    val = (newUser["address"], newUser["ref"], newUser["signature"], newUser["IP"])
    cur.execute(sql, val)
    conn.commit()

    if mail is not None and not isParameterSQL(mail):
        sql = "UPDATE users SET mail =%s WHERE address =%s"
        val = (mail, request.json['address'])
        cur.execute(sql, val)
        conn.commit()
    if wallet_id is not None and not isParameterSQL(wallet_id):
        sql = "UPDATE users SET wallet_id =%s WHERE address =%s"
        val = (wallet_id, request.json['address'])
        cur.execute(sql, val)
        conn.commit()
    if used_ref is not None and not isParameterSQL(used_ref):
        sql = "UPDATE users SET used_ref =%s WHERE address =%s"
        val = (used_ref, request.json['address'])
        cur.execute(sql, val)
        conn.commit()
    return jsonify(newUser)

# GET registrations
@app.server.route('/api/v1/<address>/registrations', methods=['GET'])
def getRegistrations(address):
    query_parameters = request.args
    signature = query_parameters.get('signature').replace(" ","+")
    json_all = {"fiat2crypto": [], "crypto2fiat": []}
    json_all['fiat2crypto'] = getFiat2Crypto(address).json
    json_all['crypto2fiat'] = getCrypto2Fiat(address).json
    return jsonify(json_all), 201

# GET/PUT registrations
@app.server.route('/api/v1/<address>/fiat2crypto', methods=['GET','PUT'])
def getFiat2Crypto(address):
    query_parameters = request.args
    signature = query_parameters.get('signature').replace(" ","+")
    checkAddressAndSignature(address,signature)

    if request.method == 'GET':
        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users where address=%s AND signature=%s"
        val = (address, signature)
        cur.execute(sql, val)

        if cur.arraysize > 0:
            conn.close()
            connReg = createDBConnection()
            curReg = connReg.cursor()
            sqlReg = "SELECT * FROM fiat2crypto where address=%s"
            curReg.execute(sqlReg, (address,))

            if curReg.arraysize > 0:
                row_headers = [x[0] for x in curReg.description]
                rv = curReg.fetchall()
                json_data = []
                for result in rv:
                    json_data.append(dict(zip(row_headers, result)))
                for json_created in json_data:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")
                return jsonify(json_data)
            else:
                abort(404, 'No registrations with requested legacy address and signature found!')
        else:
            abort(404, 'No User with that legacy address and signature found!')
    elif request.method == 'PUT':
        badFormat = 0
        message = 'Following data are missing:'
        if not request.json:
            abort(400, 'Data is no JSON')
        if not 'iban' in request.json:
            message += ', iban '
            badFormat = 1
        if not 'asset' in request.json:
            message += ', asset '
            badFormat = 1

        if badFormat == 1:
            abort(400, message)

        checkAddressAndSignature(address,signature)
        hash = hashlib.sha256((address+signature+str(getAssetByKey(request.json["asset"])[0].json[0]['id'])+str(request.json["iban"])).encode('utf-8')).hexdigest()
        hash = hash[0:4] + '-' + hash[4:8]+ '-' + hash[8:12]

        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users WHERE address= %s AND signature= %s"
        val = (address, signature)
        cur.execute(sql, val)
        rv = cur.fetchall()
        if cur.arraysize > 0:
            sql = "INSERT INTO fiat2crypto (id, address, iban, asset, bank_usage) VALUES (%s, %s, %s, %s, %s)"
            val = (address + ":" + str(getAssetByKey(request.json["asset"])[0].json[0]['id']), address, request.json["iban"],
                   getAssetByKey(request.json["asset"])[0].json[0]['id'],hash )
            cur.execute(sql, val)
            conn.commit()
        else:
            abort(404, 'No User with that legacy address and signature found!')

        conn.close()
        connReg = createDBConnection()
        curReg = connReg.cursor()
        sqlReg = "SELECT * FROM fiat2crypto where id=%s"
        valReg = (address + ":" + str(getAssetByKey(request.json["asset"])[0].json[0]['id']),)
        curReg.execute(sqlReg, valReg)

        if curReg.arraysize > 0:
            row_headers = [x[0] for x in curReg.description]
            rv = curReg.fetchall()
            json_data = []
            for result in rv:
                json_data.append(dict(zip(row_headers, result)))
            for json_created in json_data:
                json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")
        return jsonify(json_data),201
# GET crypto2fiat
@app.server.route('/api/v1/<address>/crypto2fiat', methods=['GET','PUT'])
def getCrypto2Fiat(address):
    query_parameters = request.args
    signature = query_parameters.get('signature').replace(" ","+")
    checkAddressAndSignature(address,signature)
    if request.method == 'GET':
        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users where address=%s AND signature=%s"
        val = (address, signature)
        cur.execute(sql, val)

        if cur.arraysize > 0:
            conn.close()
            connReg = createDBConnection()
            curReg = connReg.cursor()
            sqlReg = "SELECT * FROM crypto2fiat where address=%s"
            curReg.execute(sqlReg, (address,))

            if curReg.arraysize > 0:
                row_headers = [x[0] for x in curReg.description]
                rv = curReg.fetchall()
                json_data = []
                for result in rv:
                    json_data.append(dict(zip(row_headers, result)))
                for json_created in json_data:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")
                return jsonify(json_data)
            else:
                jsonify([]), 404, 'No crypto2fiat with requested legacy address and signature found!'
        else:
            abort(404, 'No User with that legacy address and signature found!')
    elif request.method == 'PUT':
        badFormat = 0
        message = 'Following data are missing:'
        if not request.json:
            abort(400, 'Data is no JSON')
        if not 'iban' in request.json:
            message += ', iban '
            badFormat = 1
        if not 'fiat' in request.json:
            message += ', asset '
            badFormat = 1
        if badFormat == 1:
            abort(400, message)

        checkAddressAndSignature(address,signature)
        if getFiatByKey(request.json["fiat"])[0] == '[]':
           abort(400, 'Asset is not available')

        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users WHERE address= %s AND signature= %s"
        val = (address, signature)
        cur.execute(sql, val)
        rv = cur.fetchall()
        if cur.arraysize > 0:
            sql = "INSERT INTO crypto2fiat (id, address, fiat,iban) VALUES (%s, %s, %s, %s)"
            val = (request.json['iban'] + ":" + getFiatByKey(request.json['fiat'])[0]['id'], address, request.json["fiat"],request.json["iban"])
            cur.execute(sql, val)
            conn.commit()
        else:
            abort(404, 'No User with that legacy address and signature found!')

        return jsonify(getCrypto2Fiat(address)), 201

# GET all assets
@app.server.route('/api/v1/assets', methods=['GET'])
def getAllAssets():
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from token_info"
    cur.execute(executeString)
    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_assets = []
        for result in rv:
            json_assets.append(dict(zip(row_headers, result)))
        for json_created in json_assets:
            del json_created['created']
        return jsonify(json_assets), 201

# GET asset with key
@app.server.route('/api/v1/assets/<key>', methods=['GET'])
def getAssetByKey(key):
    if key is None or isParameterSQL(key):
        abort(400, 'Invalid key')
    conn = createDBConnection()
    cur = conn.cursor(buffered=True)
    if IsInt(key):
        sql = "Select * from token_info WHERE id= %s"
    else:
        sql = "Select * from token_info WHERE name= %s"
    val = (key, )
    cur.execute(sql, val)
    conn.commit()
    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_assets = []
        for result in rv:
            json_assets.append(dict(zip(row_headers, result)))
        for json_created in json_assets:
            del json_created['created']
        return jsonify(json_assets), 201

# GET all assets
@app.server.route('/api/v1/fiat', methods=['GET'])
def getAllFiat():
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from fiat_info"
    cur.execute(executeString)
    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_assets = []
        for result in rv:
            json_assets.append(dict(zip(row_headers, result)))
        for json_created in json_assets:
            del json_created['created']
        return jsonify(json_assets), 201

# GET fiat with key
@app.server.route('/api/v1/fiat/<key>', methods=['GET'])
def getFiatByKey(key):
    if key is None or isParameterSQL(key):
        abort(400, 'Invalid key')
    conn = createDBConnection()
    cur = conn.cursor(buffered=True)

    if IsInt(key):
        sql = "Select * from fiat_info WHERE id= %s"
    else:
        sql = "Select * from fiat_info WHERE name= %s"
    val = (key, )
    cur.execute(sql, val)
    conn.commit()
    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_fiat = []
        for result in rv:
            json_fiat.append(dict(zip(row_headers, result)))
        for json_created in json_fiat:
            del json_created['created']
        return jsonify(json_fiat), 201

# Get all data
@app.server.route('/api/v1/allData', methods=['GET'])
def getAllData():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')

    if isParameterSQL(auth):
        abort(401, 'Unauthorized')
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from admin"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_admin = []
        for result in rv:
            json_admin.append(dict(zip(row_headers, result)))
        if json_admin[0]['oAuth'] == auth:
            executeString = "SELECT * from fiat2crypto"
            cur.execute(executeString)

            if cur.arraysize > 0:
                row_headers = [x[0] for x in cur.description]
                rv = cur.fetchall()
                json_fiat2crypto = []
                for result in rv:
                    json_fiat2crypto.append(dict(zip(row_headers, result)))
                for json_created in json_fiat2crypto:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")

            executeString = "SELECT * from crypto2fiat"
            cur.execute(executeString)

            if cur.arraysize > 0:
                row_headers = [x[0] for x in cur.description]
                rv = cur.fetchall()
                json_crypto2fiat = []
                for result in rv:
                    json_crypto2fiat.append(dict(zip(row_headers, result)))
                for json_created in json_crypto2fiat:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")

            executeString = "SELECT * from users"
            cur.execute(executeString)

            if cur.arraysize > 0:
                row_headers = [x[0] for x in cur.description]
                rv = cur.fetchall()
                json_users = []
                for result in rv:
                    json_users.append(dict(zip(row_headers, result)))
                for json_created in json_users:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")

            executeString = "SELECT * from wallets"
            cur.execute(executeString)

            if cur.arraysize > 0:
                row_headers = [x[0] for x in cur.description]
                rv = cur.fetchall()
                json_wallets = []
                for result in rv:
                    json_wallets.append(dict(zip(row_headers, result)))
                for json_created in json_wallets:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")

            executeString = "SELECT * from transactions"
            cur.execute(executeString)

            if cur.arraysize > 0:
                row_headers = [x[0] for x in cur.description]
                rv = cur.fetchall()
                json_transactions = []
                for result in rv:
                    json_transactions.append(dict(zip(row_headers, result)))
                for json_created in json_transactions:
                    json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")

            json_all = {"fiat2crypto": [],"crypto2fiat": [], "users": [], "wallets": [], "transactions": []}
            json_all['fiat2crypto'] = json_fiat2crypto
            json_all['crypto2fiat'] = json_crypto2fiat
            json_all['users'] = json_users
            json_all['wallets'] = json_wallets
            json_all['transactions'] = json_transactions
            return jsonify(json_all),201
        else:
            abort(401, 'Unauthorized')

# Add/Update Transaction
@app.server.route('/api/v1/transaction', methods=['POST'])
def addTransactiom():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')
    if isParameterSQL(auth):
        abort(401, 'Unauthorized')
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from admin"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_admin = []
        for result in rv:
            json_admin.append(dict(zip(row_headers, result)))
        if json_admin[0]['oAuth'] == auth:
            badFormat = 0
            message = 'Following data are missing:'
            if not request.json:
                abort(400, 'Data is no JSON')
            if not 'bank_usage' in request.json:
                message += ', bank_usage'
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
                return jsonify(""),201
    else:
        abort(401, 'Unauthorized')

#PUT asset
@app.server.route('/api/v1/assets', methods=['PUT'])
def addAsset():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')
    if isParameterSQL(auth):
        abort(401, 'Unauthorized')
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from admin"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_admin = []
        for result in rv:
            json_admin.append(dict(zip(row_headers, result)))
        if json_admin[0]['oAuth'] == auth:
            badFormat = 0
            message = 'Following data are missing:'
            if not request.json:
                abort(400, 'Data is no JSON')
            if not 'id' in request.json:
                message += ', id '
                badFormat = 1
            if not 'name' in request.json:
                message += ', name '
                badFormat = 1
            if not 'type' in request.json:
                message += ', type '
                badFormat = 1
            if not 'buyable' in request.json:
                message += ', buyable '
                badFormat = 1
            if not 'sellable' in request.json:
                message += ', sellable '
                badFormat = 1
            if badFormat == 1:
                abort(400, message)

            if getAssetByKey(request.json["id"]) != '[]':
                abort(400, 'Asset exists already')
            if request.json['type'] != 'Coin' and request.json['type'] != 'DAT' and request.json['type'] != 'DCT':
                abort(400, "Type must be 'Coin', 'DAT' or 'DCT'")
            if request.json['buyable'] != '0' and request.json['buyable'] != '1':
                abort(400, "Buyable must be '0' or '1'")
            if request.json['sellable'] != '0' and request.json['sellable'] != '1':
                abort(400, "Sellable must be '0' or '1'")

            sql = "INSERT INTO token_info (id, name, type, buyable, sellable) VALUES (%s, %s, %s, %s, %s)"
            val = (request.json['id'],request.json['name'],request.json['type'],request.json['buyable'],request.json['sellable'])
            cur.execute(sql, val)
            conn.commit()
            return getAssetByKey(request.json["id"]),201
        else:
            abort(401, 'Unauthorized')

# POST asset with key
@app.server.route('/api/v1/assets/<key>', methods=['POST'])
def updateAsset(key):
    query_parameters = request.args
    auth = query_parameters.get('oAuth')

    if isParameterSQL(auth):
        abort(401, 'Unauthorized')
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from admin"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_admin = []
        for result in rv:
            json_admin.append(dict(zip(row_headers, result)))
            if json_admin[0]['oAuth'] == auth:
                if key is None or isParameterSQL(key):
                    abort(400, 'Invalid key')
                conn = createDBConnection()
                cur = conn.cursor(buffered=True)

                if 'id' in request.json:
                    if not isParameterSQL(request.json['id']):
                            changeID = False
                            if IsInt(key):
                                sql = "UPDATE token_info SET id =%s WHERE id= %s"
                                changeID=True
                            else:
                                sql = "UPDATE token_info SET id =%s WHERE name= %s"
                            val = (request.json['id'],key)
                            cur.execute(sql, val)
                            conn.commit()
                            if changeID: key = request.json['id']
                if 'name' in request.json:
                    if not isParameterSQL(request.json['name']):
                        changeName = False
                        if IsInt(key):
                            sql = "UPDATE token_info SET name =%s WHERE id= %s"
                        else:
                            sql = "UPDATE token_info SET name =%s WHERE name= %s"
                            changeName = True
                        val = (request.json['name'],key)
                        cur.execute(sql, val)
                        conn.commit()
                        if changeName: key = request.json['name']
                if 'type' in request.json:
                    if not isParameterSQL(request.json['type']):
                        if request.json['type'] == 'Coin' or request.json['type'] == 'DAT' or request.json['type'] == 'DCT':
                            if IsInt(key):
                                sql = "UPDATE token_info SET type =%s WHERE id= %s"
                            else:
                                sql = "UPDATE token_info SET type =%s WHERE name= %s"
                            val = (request.json['type'],key)
                            cur.execute(sql, val)
                            conn.commit()
                if 'buyable' in request.json:
                    if not isParameterSQL(request.json['buyable']):
                        if request.json['buyable'] == '0' or request.json['buyable'] == '1':
                            if IsInt(key):
                                sql = "UPDATE token_info SET buyable =%s WHERE id= %s"
                            else:
                                sql = "UPDATE token_info SET buyable =%s WHERE name= %s"
                            val = (request.json['buyable'],key)
                            cur.execute(sql, val)
                            conn.commit()
                if 'sellable' in request.json:
                    if not isParameterSQL(request.json['sellable']):
                        if request.json['sellable'] == '0' or request.json['sellable'] == '1':
                            if IsInt(key):
                                sql = "UPDATE token_info SET sellable =%s WHERE id= %s"
                            else:
                                sql = "UPDATE token_info SET sellable =%s WHERE name= %s"
                            val = (request.json['sellable'],key)
                            cur.execute(sql, val)
                            conn.commit()
                return getAssetByKey(key),201
            else:
                abort(401, 'Unauthorized')

#PUT asset
@app.server.route('/api/v1/fiat', methods=['PUT'])
def addFiat():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')
    if isParameterSQL(auth):
        abort(401, 'Unauthorized')
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from admin"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_admin = []
        for result in rv:
            json_admin.append(dict(zip(row_headers, result)))
        if json_admin[0]['oAuth'] == auth:
            badFormat = 0
            message = 'Following data are missing:'
            if not request.json:
                abort(400, 'Data is no JSON')
            if not 'id' in request.json:
                message += ', id '
                badFormat = 1
            if not 'name' in request.json:
                message += ', name '
                badFormat = 1
            if not 'enable' in request.json:
                message += ', enable '
                badFormat = 1
            if badFormat == 1:
                abort(400, message)

            if getFiatByKey(request.json["id"])[0].json != []:
                abort(400, 'Fiat already exists')
            if request.json['enable'] != '0' and request.json['enable'] != '1':
                abort(400, "Enable must be '0' or '1'")

            sql = "INSERT INTO fiat_info (id, name, enable) VALUES (%s, %s, %s)"
            val = (request.json['id'],request.json['name'],request.json['enable'])
            cur.execute(sql, val)
            conn.commit()
            return jsonify(getFiatByKey(request.json["id"])[0].json),201
        else:
            abort(401, 'Unauthorized')

# POST asset with key
@app.server.route('/api/v1/fiat/<key>', methods=['POST'])
def updateFiat(key):
    query_parameters = request.args
    auth = query_parameters.get('oAuth')

    if isParameterSQL(auth):
        abort(401, 'Unauthorized')
    conn = createDBConnection()
    cur = conn.cursor()
    executeString = "SELECT * from admin"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_admin = []
        for result in rv:
            json_admin.append(dict(zip(row_headers, result)))
            if json_admin[0]['oAuth'] == auth:
                if key is None or isParameterSQL(key):
                    abort(400, 'Invalid key')
                conn = createDBConnection()
                cur = conn.cursor(buffered=True)
                if getFiatByKey(key)[0].json == []:
                    abort(400, "ID is not available")

                if 'id' in request.json:
                    if not isParameterSQL(request.json['id']):
                            if key != request.json['id']:
                                if getFiatByKey(request.json['id'])[0].json != []:
                                    abort(400, "ID already exists")
                            changeID = False
                            if IsInt(key):
                                sql = "UPDATE fiat_info SET id =%s WHERE id= %s"
                                changeID=True
                            else:
                                sql = "UPDATE fiat_info SET id =%s WHERE name= %s"
                            val = (request.json['id'],key)
                            cur.execute(sql, val)
                            conn.commit()
                            if changeID: key = request.json['id']
                if 'name' in request.json:
                    if not isParameterSQL(request.json['name']):
                        changeName = False
                        if IsInt(key):
                            sql = "UPDATE fiat_info SET name =%s WHERE id= %s"
                        else:
                            sql = "UPDATE fiat_info SET name =%s WHERE name= %s"
                            changeName = True
                        val = (request.json['name'],key)
                        cur.execute(sql, val)
                        conn.commit()
                        if changeName: key = request.json['name']
                if 'enable' in request.json:
                    if not isParameterSQL(request.json['enable']):
                        if request.json['enable'] != '0' and request.json['enable'] != '1':
                            abort(400, "Enable must be '0' or '1'")
                        if IsInt(key):
                            sql = "UPDATE fiat_info SET enable =%s WHERE id= %s"
                        else:
                            sql = "UPDATE fiat_info SET enable =%s WHERE name= %s"
                        val = (request.json['enable'],key)
                        cur.execute(sql, val)
                        conn.commit()
                return jsonify(getFiatByKey(key)[0].json),201
            else:
                abort(401, 'Unauthorized')
#Help functions

def createDBConnection():
    try:
        conn = mysql.connector.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
        return conn
    except mysql.connector.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

def isParameterSQL(param):
    param = str(param)
    if ('SELECT' in param or
            'FROM' in param or
            'WHERE' in param or
            'ORDER' in param or
            'BY' in param or
            'GROUP' in param or
            'INSERT' in param or
            'INTO' in param or
            'DELETE' in param or
            'UPDATE' in param or
            'CREATE' in param or
            'INDEX' in param or
            'VIEW' in param or
            'DROP' in param or
            'TABLE' in param or
            'ALTER' in param):
        return True
    else:
        return False

def IsInt(s):
    try:
        int(s)
        return True
    except ValueError:
        return False

def checkAddressAndSignature(address,signature):
    if address is None or isParameterSQL(address):
        abort(400, 'Legacy address is missing')
    if signature is None or isParameterSQL(signature):
        abort(400, "Signature not found")
    if not address.startswith('8') or not len(address) == 34:
        abort(400, 'Legacy address is wrong')
    if signature is None or isParameterSQL(signature):
        abort(400, 'Signature is missing')
    if not len(signature) == 88 or not signature.endswith('='):
        abort(400, 'Signature is wrong')
    return True