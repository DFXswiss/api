import dash
import dash_html_components as html
from appIndexString import appIndexStringClass

app = dash.Dash(__name__)
app.layout =html.Div("")
app.index_string = appIndexStringClass.getAppIndexString()

from routes import *

if __name__ == "__main__":
   app.run_server(debug=False)