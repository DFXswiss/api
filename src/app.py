
# TODO
# Doku anzeigen lassen (swagger.json oder yaml)
# Banküberweisungen ziehen via API: Verwendungszweck,
# Transaktionsgebühren: legacy adresse, signatur, wallet id? -> Robin?
# UpdateServer secret + GitHub webhooks
# Config von DB in extra File
import dash
from flask import Flask


app = Flask(__name__)
app.config["SECRET_KEY"] = "api-fiat2defi"

from routes import *
if __name__ == "__main__":
   app.run(debug=True)