# Developer zone

### Local database 

- Docker daemon running. Use following command to verify it.
`docker ps`

- Move to docker folder
- Build a new DB with
`docker build . -t dfx-api-db`

- Run the image previously built
`docker run -d -p 1433:1433 -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=BaQh5@yB68V423eX@pGm" --name dfx-api-db dfx-api-db`

### General docker commands to clean stuff (container, images)

- Stop all containers:
`docker kill $(docker ps -q)`

- Remove containers:
`docker rm $(docker ps -a -q)`

- Remove images:
`docker rmi $(docker images -q)`
