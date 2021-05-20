from app import app
from flask import render_template
import mariadb
import sys

import forms



@app.route("/")
@app.route("/index")
def index():
    return render_template("index.html")

@app.route('/api/v2/userInformation', methods=["POST","GET"])
def getUserInformation():    
    """Returns user's information from legacy address"""
    form = forms.ApiFormController()

    if form.validate_on_submit():
        print("HOLA1!")
        try:
          conn = mariadb.connect(
                  user="d0367ab1",
                  password="SBN3URDAqP6ZKJxV",
                  host="85.13.138.57",
                  port=3306,
                  database="d0367ab1")
        except mariadb.Error as e:
           print(f"Error connecting to MariaDB Platform: {e}")
           sys.exit(1)
        
        # Get Cursor
        cur = conn.cursor()

        cur.execute("SELECT * FROM token_info")
        for i in cur:
            print (i)

        return render_template("userInformation.html", form=form, 
        legacyAddress=form.legacyAddress.data,
        signature = form.signature.data,
        mail = form.mail.data,
        kyc = form.kyc.data,
        ip = form.ip.data )
    else:
        print("HOLA 2!")
        return render_template("userInformation.html", form=form)