FROM node:14
WORKDIR /
COPY package*.json ./
COPY tsconfig.json ./tsconfig.json
COPY ./patches ./patches
COPY ./assets/tsconfig.json ./assets/tsconfig.json
COPY ./assets/main.ts ./assets/main.ts
COPY ./assets/main.css ./assets/main.css
COPY ./assets/control.html ./assets/control.html
COPY ./server.ts ./server.ts
COPY ./commonTypes.ts ./commonTypes.ts 
RUN npm install
RUN npx patch-package
RUN npm run build
RUN npm ci --only=production
RUN rm -r *.ts
CMD [ "node", "server.js" ]