FROM node:latest AS builder
WORKDIR /app
COPY ./package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:latest
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3000:3000
CMD [ "npm", "run", "start" ]