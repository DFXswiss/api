from flask_wtf import FlaskForm
from wtforms import StringField, SubmitField

class ApiFormController(FlaskForm):
    legacyAddress = StringField("legacyAddress")
    signature = StringField("signature")
    mail = StringField("main")
    kyc = StringField("kyc")
    ip = StringField("ip")
    submit = SubmitField("Submit")


