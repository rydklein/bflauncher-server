FROM node:14
WORKDIR /
COPY package*.json ./
COPY ./patches ./patches
RUN npm install
RUN npm ci --only=production
COPY ./assets ./assets
COPY ./server.js ./server.js

CMD [ "node", "server.js" ]
