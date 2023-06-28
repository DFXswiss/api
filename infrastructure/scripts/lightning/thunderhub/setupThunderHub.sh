#!/bin/bash

# Refer to:
# https://docs.thunderhub.io/setup
# https://docs.thunderhub.io/installation

curl -sL https://deb.nodesource.com/setup_16.x | sudo -E bash -

sudo apt update
sudo apt-get install -y nodejs

git clone https://github.com/apotdevin/thunderhub.git
cd thunderhub

npm install
npm run build

npx browserslist@latest --update-db
