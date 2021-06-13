
# TODO
# Doku anzeigen lassen (swagger.json oder yaml)
# Banküberweisungen ziehen via API: Verwendungszweck,
# Transaktionsgebühren: legacy adresse, signatur, wallet id? -> Robin?
# UpdateServer secret + GitHub webhooks
# Config von DB in extra File
import dash
import dash_html_components as html
from src.appIndexString import appIndexStringClass

app = dash.Dash(__name__)
app.layout =html.Div("")
app.index_string = appIndexStringClass.getAppIndexString()

from routes import *

if __name__ == "__main__":
   app.run_server(debug=False)