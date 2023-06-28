#!/bin/bash

# Refer to Option 1 (recommended):
# https://github.com/lnbits/lnbits/blob/main/docs/guide/installation.md

git clone https://github.com/lnbits/lnbits.git
cd lnbits

sudo apt update
sudo apt install software-properties-common -y
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.9 python3.9-distutils -y

curl -sSL https://install.python-poetry.org | python3 -

export PATH="/home/dfx/.local/bin:$PATH"

poetry env use python3.9
poetry install --only main

mkdir data
