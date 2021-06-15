import dash_html_components as html
from flask import Flask

from appIndexString import appIndexStringClass

app = Flask(__name__)
app.layout =html.Div("")
app.index_string = appIndexStringClass.getAppIndexString()

from routes import *

if __name__ == "__main__":
   app.run()