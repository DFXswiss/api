# Multi-stage build for the dfx-api NestJS service.
#
# Built and pushed by .github/workflows/dfx-api-{dev,prd}.yaml as
# dfxswiss/dfx-api:{beta,latest} (linux/arm64).

FROM node:20-alpine AS builder

# node-gyp needs Python + a C/C++ toolchain to build native modules
RUN apk add --no-cache python3 make g++

USER node
WORKDIR /home/node

ADD --chown=node:node package.json .
ADD --chown=node:node package-lock.json .
RUN npm ci

ADD --chown=node:node . .
RUN npm run build
# Drop dev deps in-place after the build so the runtime stage can copy
# the already-compiled native modules without needing python3 + g++.
RUN npm prune --omit=dev


FROM node:20-alpine

USER node
WORKDIR /home/node

COPY --from=builder /home/node/package.json /home/node/package-lock.json ./
COPY --from=builder /home/node/node_modules ./node_modules
COPY --from=builder /home/node/dist ./dist
COPY --from=builder /home/node/migration ./migration
# Runtime assets referenced by source path (not dist/) in the app config:
#   - i18n translations: config.ts → join(process.cwd(), 'src/shared/i18n/')
#   - notification templates: *.hbs files
COPY --from=builder /home/node/src/shared/i18n ./src/shared/i18n
COPY --from=builder /home/node/src/subdomains/supporting/notification/templates ./src/subdomains/supporting/notification/templates

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
