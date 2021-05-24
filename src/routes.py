from app import app
from flask import render_template
import mysql.connector
import sys
import json
from flask import abort, request
from bson.json_util import dumps
import config_file

#TODO Swagger Docu

@app.server.route("/")
@app.server.route("/index")
def index():
    return render_template("index.html")

@app.server.route('/api/v1/user', methods=["GET"])
def getOrCeateUser():
    """Returns user's information from legacy address"""
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    signature = query_parameters.get('signature')
    mail = query_parameters.get('mail')
    ip = query_parameters.get('ip')
    wallet_id =query_parameters.get('wallet_id')
    used_ref = query_parameters.get('used_ref')

    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    if not legacyAddress.startswith('8') or not len(legacyAddress) == 34:
        abort(400, 'Legacy address is wrong')
    if signature is None:
        abort(400, 'Signature is missing')
    if not len(signature) == 88 or not signature.endswith('='):
        abort(400, 'Signature is wrong')
    if ip is None:
        abort(400, 'IP is missing')
    try:
        conn = mysql.connector.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mysql.connector.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

    cur = conn.cursor()
    executeString = "SELECT * FROM users where address='" + legacyAddress + "'"
    cur.execute(executeString)
    rv = cur.fetchall()
    if len(rv) > 0:
        row_headers = [x[0] for x in cur.description]
        json_data = []
        for result in rv:
            json_data.append(dict(zip(row_headers, result)))

        json_data[0]['created'] = json_data[0]['created'].strftime("%Y-%m-%dT%H:%M:%S")

        if mail is not None:
            json_data[0]['mail'] = mail
            executeString = "UPDATE users SET mail = '"+mail +"' WHERE address = '" +legacyAddress+ "'"
            cur.execute(executeString)
            conn.commit()
        if wallet_id is not None:
            json_data[0]['wallet_id'] = wallet_id
            executeString = "UPDATE users SET wallet_id = '" + wallet_id + "' WHERE address = '" + legacyAddress + "'"
            cur.execute(executeString)
            conn.commit()
        if used_ref is not None:
            json_data[0]['used_ref'] = used_ref
            executeString = "UPDATE users SET used_ref = '" + used_ref + "' WHERE address = '" + legacyAddress + "'"
            cur.execute(executeString)
            conn.commit()
        # return the results!
        return json.dumps(json_data[0], indent=2)
    else:
        newUser = {}
        newUser["address"] = legacyAddress
        executeString = "SELECT * FROM users"
        cur = conn.cursor()
        cur.execute(executeString)
        rv = cur.fetchall()
        ref_int = cur.rowcount
        newUser["ref"] = str(ref_int+1)
        newUser["signature"] = signature
        if mail is not None: newUser["mail"] = mail
        if wallet_id is not None: newUser["wallet_id"] = wallet_id
        if used_ref is not None: newUser["used_ref"] = used_ref
        newUser["IP"] = ip


        sql = "INSERT INTO users (address, ref, signature, IP) VALUES (%s, %s, %s, %s)"
        val = (newUser["address"], newUser["ref"], newUser["signature"], newUser["IP"])
        cur.execute(sql, val)
        conn.commit()

        if mail is not None:
            executeString = "UPDATE users SET mail = '" + mail + "' WHERE address = '" + legacyAddress + "'"
            cur.execute(executeString)
            conn.commit()
        if wallet_id is not None:
            executeString = "UPDATE users SET wallet_id = '" + wallet_id + "' WHERE address = '" + legacyAddress + "'"
            cur.execute(executeString)
            conn.commit()
        if used_ref is not None:
            executeString = "UPDATE users SET used_ref = '" + used_ref + "' WHERE address = '" + legacyAddress + "'"
            cur.execute(executeString)
            conn.commit()
        return dumps(newUser, indent=2)

# Get wallet registrations
@app.server.route('/api/v1/registrations', methods=['GET'])
def getRegistrations():
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    if not legacyAddress.startswith('8') or not len(legacyAddress) == 34:
        abort(400, 'Legacy address is wrong')
    try:
        conn = mysql.connector.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mysql.connector.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

    cur = conn.cursor()
    executeString = "SELECT * FROM registrations where address='" + legacyAddress + "'"
    cur.execute(executeString)

    if cur.arraysize > 0:
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_data = []
        for result in rv:
            json_data.append(dict(zip(row_headers, result)))

        for json_created in json_data:
            json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")
        # return the results!
        return json.dumps(json_data, indent=2)
    else:
        abort(404, 'No registrations with requested legacy address found!')

# Get all data
@app.server.route('/api/v1/allData', methods=['GET'])
def getAllData():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')

    try:
        conn = mysql.connector.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mysql.connector.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

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

            json_all = {"registrations": [], "users": [],"wallets": [],"transactions": []}
            json_all['registrations'] = json_registrations
            json_all['users'] = json_users
            json_all['wallets'] = json_wallets
            json_all['transactions'] = json_transactions
            return json.dumps(json_all, indent=2)
        else:
            abort(401, 'Unauthorized')

# Add/Update Transaction
@app.server.route('/api/v1/addTransaction', methods=['POST'])
def addTransactiom():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')

    try:
        conn = mysql.connector.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mysql.connector.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

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

            executeString = "SELECT * FROM users where address"
            cur.execute(executeString)


    else:
        abort(401, 'Unauthorized')