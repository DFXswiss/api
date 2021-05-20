
# TODO
# Doku anzeigen lassen (swagger.json oder yaml)
# Banküberweisungen ziehen via API: Verwendungszweck,
# Transaktionsgebühren: legacy adresse, signatur, wallet id? -> Robin?
#
# UpdateServer secret + GitHub webhooks

app = Flask(__name__)
app.config["SECRET_KEY"] = "api-fiat2defi"

from routes import *