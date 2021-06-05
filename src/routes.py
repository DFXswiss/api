from werkzeug.utils import redirect

from app import app
from flask import render_template, jsonify
import mysql.connector
import sys
import json
from flask import abort, request
from bson.json_util import dumps
import config_file

@app.server.route("/")
@app.server.route("/index")
def index():
    return redirect("https://app.swaggerhub.com/apis-docs/meintest/Api-Fiat2Defichain/1")

#GET/POST/PUT address
@app.server.route('/api/v1/user/<address>', methods=["GET","POST","PUT"])
def getOrCeateUser(address):
    query_parameters = request.args
    if request.method == 'GET':
        signature = query_parameters.get('signature')
        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users where address = %s and signature = %s"
        val = (address.split(':')[0],signature)
        cur.execute(sql, val)
        rv = cur.fetchall()
        if len(rv) > 0:
            row_headers = [x[0] for x in cur.description]
            json_data = []
            for result in rv:
                json_data.append(dict(zip(row_headers, result)))
            json_data[0]['created'] = json_data[0]['created'].strftime("%Y-%m-%dT%H:%M:%S")
            return json.dumps(json_data[0], indent=2)
        else:
            abort(404, 'No User with that legacy address and signature found!')
    elif request.method == 'POST':
        signature = query_parameters.get('signature')
        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users where address = %s and signature = %s"
        val = (address.split(':')[0],signature)
        cur.execute(sql, val)
        rv = cur.fetchall()
        if len(rv) > 0:
            mail = query_parameters.get('mail')
            wallet_id = query_parameters.get('wallet_id')
            used_ref = query_parameters.get('used_ref')
            ip = query_parameters.get('ip')
            row_headers = [x[0] for x in cur.description]
            json_data = []
            for result in rv:
                json_data.append(dict(zip(row_headers, result)))
            json_data[0]['created'] = json_data[0]['created'].strftime("%Y-%m-%dT%H:%M:%S")
            if mail is not None and not isParameterSQL(mail):
                json_data[0]['mail'] = mail
                sql = "UPDATE users SET mail = %s WHERE address = %s"
                val = (mail, address.split(':')[0])
                cur.execute(sql, val)
                conn.commit()
            if wallet_id is not None and not isParameterSQL(wallet_id):
                json_data[0]['wallet_id'] = int(wallet_id)
                sql = "UPDATE users SET wallet_id = %s WHERE address = %s"
                val = (wallet_id, address.split(':')[0])
                cur.execute(sql, val)
                conn.commit()
            if used_ref is not None and not isParameterSQL(used_ref):
                json_data[0]['used_ref'] = int(used_ref)
                sql = "UPDATE users SET used_ref = %s WHERE address = %s"
                val = (used_ref, address.split(':')[0])
                cur.execute(sql, val)
                conn.commit()
            if ip is not None and not isParameterSQL(ip):
                json_data[0]['ip'] = int(ip)
                sql = "UPDATE users SET ip = %s WHERE address = %s"
                val = (ip, address.split(':')[0])
                cur.execute(sql, val)
                conn.commit()
            return json.dumps(json_data[0], indent=2)
    else:
        signature = query_parameters.get('signature')
        if address.split(':')[0] is None or isParameterSQL(address.split(':')[0]):
            abort(400, 'Legacy address is missing')
        if signature is None or isParameterSQL(signature):
            abort(400, "Signature not found")
        if not address.split(':')[0].startswith('8') or not len(address.split(':')[0]) == 34:
            abort(400, 'Legacy address is wrong')
        if signature is None or isParameterSQL(signature):
            abort(400, 'Signature is missing')
        if not len(signature) == 88 or not signature.endswith('='):
            abort(400, 'Signature is wrong')

        newUser = {}
        mail = query_parameters.get('mail')
        ip = query_parameters.get('ip')
        wallet_id = query_parameters.get('wallet_id')
        used_ref = query_parameters.get('used_ref')
        newUser["address"] = address.split(':')[0]
        executeString = "SELECT * FROM users"
        conn = createDBConnection()
        cur = conn.cursor()
        cur.execute(executeString)
        rv =cur.fetchall()
        ref_int = cur.rowcount
        newUser["ref"] = ref_int + 1
        newUser["signature"] = signature
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
            val = (mail, address.split(':')[0])
            cur.execute(sql, val)
            conn.commit()
        if wallet_id is not None and not isParameterSQL(wallet_id):
           sql = "UPDATE users SET wallet_id =%s WHERE address =%s"
           val = (wallet_id, address.split(':')[0])
           cur.execute(sql, val)
           conn.commit()
        if used_ref is not None and not isParameterSQL(used_ref):
            sql = "UPDATE users SET used_ref =%s WHERE address =%s"
            val = (used_ref, address.split(':')[0])
            cur.execute(sql, val)
            conn.commit()
        return dumps(newUser, indent=2)

# GET/PUT registrations
@app.server.route('/api/v1/<address>/registrations', methods=['GET',"PUT"])
def getRegistrations(address):
    if request.method == 'GET':
        query_parameters = request.args
        signature = query_parameters.get('signature')
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
                return json.dumps(json_data, indent=2)
            else:
                abort(404, 'No registrations with requested legacy address and signature found!')
        else:
            abort(404, 'No User with that legacy address and signature found!')
    elif request.method == 'PUT':
        badFormat = 0
        message = 'Following data are missing:'
        if not request.json:
            abort(400, 'Data is no JSON')
        if not 'signature' in request.json:
            message += ', signature '
            badFormat = 1
        if not 'iban' in request.json:
            message += ', iban '
            badFormat = 1
        if not 'asset' in request.json:
            message += ', asset '
            badFormat = 1

        if badFormat == 1:
            abort(400, message)

        if address is None or isParameterSQL(address):
            abort(400, 'Legacy address is missing')
        if not address.startswith('8') or not len(address) == 34:
            abort(400, 'Legacy address is wrong')
        if request.json["signature"] is None or isParameterSQL(request.json["signature"]):
            abort(400, "Signature not found")
        if not len(request.json["signature"]) == 88 or not request.json["signature"].endswith('='):
            abort(400, 'Signature is wrong')

        conn = createDBConnection()
        cur = conn.cursor()
        sql = "SELECT * FROM users WHERE address= %s AND signature= %s"
        val = (address, request.json["signature"])
        cur.execute(sql, val)
        rv = cur.fetchall()
        if cur.arraysize > 0:
            sql = "INSERT INTO fiat2crypto (id, address, iban, asset, hash) VALUES (%s, %s, %s, %s, %s)"
            val = (address + ":" + request.json["asset"], address, request.json["iban"],
                   request.json["asset"], "123")
            cur.execute(sql, val)
            conn.commit()
        else:
            abort(404, 'No User with that legacy address and signature found!')

        return jsonify({'success': "true"}), 201

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
            executeString = "SELECT * from registrations"
            cur.execute(executeString)

            if cur.arraysize > 0:
                row_headers = [x[0] for x in cur.description]
                rv = cur.fetchall()
                json_registrations = []
                for result in rv:
                    json_registrations.append(dict(zip(row_headers, result)))
                for json_created in json_registrations:
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

            json_all = {"registrations": [], "users": [], "wallets": [], "transactions": []}
            json_all['registrations'] = json_registrations
            json_all['users'] = json_users
            json_all['wallets'] = json_wallets
            json_all['transactions'] = json_transactions
            return json.dumps(json_all, indent=2)
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
                return dumps("", indent=2)
    else:
        abort(401, 'Unauthorized')

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