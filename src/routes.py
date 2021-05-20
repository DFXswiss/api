from app import app
from flask import render_template
import mariadb
import sys
import json
from flask import abort, request
from bson.json_util import dumps
import config_file


# TODO: create User

@app.route("/")
@app.route("/index")
def index():
    return render_template("index.html")


@app.route('/api/v2/userInformation', methods=["POST", "GET"])
def getUserInformation():
    """Returns user's information from legacy address"""
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
        abort(400, 'IP is missing')
    try:
        conn = mariadb.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mariadb.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

    cur = conn.cursor()
    executeString = "SELECT * FROM users where address='" + legacyAddress + "'"
    cur.execute(executeString)

    if cur.arraysize > 0:
        # if mail is not None and kyc is not None:
        # coll.update_one({"address": legacyAddress}, {"$set": {"kyc": kyc, "mail": mail}})
        # serialize results into JSON
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_data = []
        for result in rv:
            json_data.append(dict(zip(row_headers, result)))

        json_data[0]['created'] = json_data[0]['created'].strftime("%Y-%m-%dT%H:%M:%S")
        # return the results!
        return json.dumps(json_data)
    else:
        newUser = {}
        newUser["address"] = legacyAddress
        newUser["signature"] = signature
        newUser["IP"] = ip
        if mail is not None: newUser["mail"] = mail
        if kyc is not None:  newUser["kyc"] = kyc

        return dumps(newUser, indent=2)


# Get wallet registrations
@app.route('/api/v2/registrations', methods=['GET'])
def getRegistrations():
    query_parameters = request.args
    legacyAddress = query_parameters.get('legacyAddress')
    if legacyAddress is None:
        abort(400, 'Legacy address is missing')
    try:
        conn = mariadb.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mariadb.Error as e:
        print(f"Error connecting to MariaDB Platform: {e}")
        sys.exit(1)

    cur = conn.cursor()
    executeString = "SELECT * FROM registrations where address='" + legacyAddress + "'"
    cur.execute(executeString)

    if cur.arraysize > 0:
        # if mail is not None and kyc is not None:
        # coll.update_one({"address": legacyAddress}, {"$set": {"kyc": kyc, "mail": mail}})
        # serialize results into JSON
        row_headers = [x[0] for x in cur.description]
        rv = cur.fetchall()
        json_data = []
        for result in rv:
            json_data.append(dict(zip(row_headers, result)))

        for json_created in json_data:
            json_created['created'] = json_created['created'].strftime("%Y-%m-%dT%H:%M:%S")
        # return the results!
        return json.dumps(json_data)
    else:
        abort(404, 'No registrations with requested legacy address found!')


# Get wallet registrations
@app.route('/api/v2/allData', methods=['GET'])
def getAllData():
    query_parameters = request.args
    auth = query_parameters.get('oAuth')

    try:
        conn = mariadb.connect(
            user=config_file.user,
            password=config_file.password,
            host=config_file.host,
            port=config_file.port,
            database=config_file.database)
    except mariadb.Error as e:
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

            json_all = {"registrations": [], "users": []}
            json_all['registrations'] = json_registrations
            json_all['users'] = json_users
            return json.dumps(json_all)
        else:
            abort(401, 'Unauthorized')
