// Imports
import http from "http";
import express from "express";
import { SeederData, ServerData, AutomationStatus } from "./commonTypes";
import * as fs from "fs";
import ExpressSession from "express-session";
import FormData from "form-data";
import fetch, { Response } from "node-fetch";
import MemoryStore from "memorystore";
import path from "path";
import socket from "socket.io";
import { waitForDebugger } from "inspector";
//#region Types
enum PermissionState {
    "SUCCESS",
    "NOT_LOGGED_IN",
    "NOT_AUTHORIZED"
}
enum GameState {
    "UNOWNED",
    "IDLE",
    "LAUNCHING",
    "JOINING",
    "ACTIVE",
}
enum BFGame {
    "BF4",
    "BF1",
}
/*interface ServerConfig {
    name?:string, // For BF1 servers, name from https://gametools.network/servers
    guid?:string, // For BF4 servers
    targetPlayers:number, // Playercount to maintain using bots. Will connect/disconnect bots to keep the server at this count.
    deadIntervals:[number, number], // Time to stop seeding server, time to start seeding server.
    emptyThreshold:number, // Minimum real playercount to seed with bots.
}*/
interface BFServer {
    id:string,
    targetPlayers:number,
    seededPlayers:number,
    deadIntervals:[number, number],
}
interface ServerConfig {
    priorityToSeedBF4:Array<number>,
    priorityToKeepAliveBF4:Array<number>,
    priorityToSeedBF1:Array<number>,
    priorityToKeepAliveBF1:Array<number>,
    serversBF4:Array<BFServer>,
    serversBF1:Array<BFServer>,
}
//#endregion
// Global Variables
const config = JSON.parse(fs.readFileSync("./config/config.json", {"encoding":"utf-8"}));
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
const webInterface = express();
const httpServer = http.createServer(webInterface);
// #region Startup
const usersPath = "./config/users.json";
const serversPath = "./config/servers.json";
let users:Array<string> = JSON.parse(fs.readFileSync(usersPath, {"encoding":"utf-8"}));
let autoSettings:ServerConfig = JSON.parse(fs.readFileSync(serversPath, {"encoding":"utf-8"}));
// #endregion
const sessionStorage = MemoryStore(ExpressSession);
const sessionConfig = {
    "secret": config.sessionSecret,
    "store": new sessionStorage({
        "checkPeriod": 3600000,
    }),
    "resave": true,
    "saveUninitialized": false,
    "cookie": {
        "maxAge": 86400000,
        "secure": false,
    },
};
const sessionMiddleware = ExpressSession(sessionConfig);
const oAuthLoginUrl = `https://discord.com/api/oauth2/authorize?client_id=${config.oauth2.client_id}&redirect_uri=${encodeURIComponent(config.oauth2.redirect_uri)}&response_type=code&scope=${encodeURIComponent(config.oauth2.scopes.join(" "))}`;
webInterface.use(sessionMiddleware);
// #region HTTP
webInterface.get("/", async (req, res) => {
    // If not logged in, redirect to login page.
    const userData = checkPermissions(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.redirect("/login");
    if (userData === PermissionState.NOT_AUTHORIZED) return res.redirect("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    res.sendFile(path.join(__dirname, "/assets/control.html"));
});

webInterface.get("/login/callback", async (req, res) => {
    const accessCode = req.query.code;
    if (!accessCode) return res.status(400).send("No access code specified");

    // Form to get user info from Discord
    const data = new FormData();
    data.append("client_id", config.oauth2.client_id);
    data.append("client_secret", config.oauth2.secret);
    data.append("grant_type", "authorization_code");
    data.append("redirect_uri", config.oauth2.redirect_uri);
    data.append("scope", "identify");
    data.append("code", accessCode);

    // Making request to oauth2/token to get the Bearer token
    const oAuthRes = await (await fetch("https://discord.com/api/oauth2/token", {method: "POST", body: data})).json();
    req.session.bearer_token = oAuthRes.access_token;
    req.session.discordUser = await (await fetch("https://discord.com/api/users/@me", {headers: { Authorization: `Bearer ${req.session.bearer_token}` } })).json();
    res.redirect("/"); // Redirecting to main page
});

webInterface.get("/login", (req, res) => {
    // Redirecting to login url
    res.redirect(oAuthLoginUrl);
});
// Assets
webInterface.get("/assets/main.js", async (req, res) => {
    const userData = checkPermissions(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.status(401).send();
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/javascript");
    res.sendFile(path.join(__dirname, "/assets/main.js")); 
});
webInterface.get("/assets/sorttable.js", async (req, res) => {
    const userData = checkPermissions(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.status(401).send();
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/javascript");
    res.sendFile(path.join(__dirname, "/assets/sorttable.js")); 
});
webInterface.get("/assets/main.css", async (req, res) => {
    const userData = checkPermissions(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.status(401).send();
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/css");
    res.sendFile(path.join(__dirname, "/assets/main.css")); 
});
// #endregion
// #region Websockets
const autoName = "Auto";
const clientToken = config.clientToken;
const seeders:Map<string, SeederData> = new Map();
const apiVersion:number = parseInt(JSON.parse(fs.readFileSync("./version.json", {"encoding":"utf-8"})).apiVersion);
let autoStatus:AutomationStatus = {
    "enabled":true,
    "user":"SYSTEM",
    "timestamp":new Date().getTime(),
};
let lastAutoTime:number = new Date().getTime() - 5000;
const io:socket.Server = new socket.Server(httpServer);
const frontEnd:socket.Namespace = io.of("/ws/web");
const backEnd:socket.Namespace = io.of("/ws/seeder");
frontEnd.use((socket, next) => {
    sessionMiddleware(socket.request as any, {} as any, next as any);
});
// When a client connects, authenticate then set listeners for it.
frontEnd.use(checkAuthFrontend);
frontEnd.use(registerSocketFrontend);
backEnd.use(checkAuthBackend);
backEnd.use(registerSocketBackend);
setInterval(setAutoTargets, 20000, BFGame.BF4);
function checkAuthFrontend(socket:socket.Socket, next) {
    const socketSession = socket.request["session"] as ExpressSession.Session & Partial<ExpressSession.SessionData>;
    const permsResult = checkPermissions(socketSession);
    if(permsResult !== PermissionState.SUCCESS) {
        next(new Error(PermissionState[permsResult]));
    } else {
        next();
    }
}
function registerSocketFrontend(socket:socket.Socket, next) {
    socket.on("getSeeders", (callback) => {
        if (typeof callback !== "function") return;
        callback(JSON.stringify(seeders, mapReplacer));
    });
    socket.on("getAuto", (callback) => {
        if (typeof callback !== "function") return;
        callback(autoStatus);
    });
    socket.on("setTarget", async (game:BFGame, seeders:Array<string>, newTarget:string, callback) => {
        let success = true;
        if (typeof callback !== "function") success = false;
        if ((game !== BFGame.BF4) && (game !== BFGame.BF1)) success = false;
        if (!isIterable(seeders)) success = false;
        if (success) {
            success = await verifyAndSetTarget(game, seeders, newTarget, `${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`);
        }
        callback(success);
    });
    socket.on("restartOrigin", (seeders:Array<string>) => {
        for (const seederId of seeders) {
            if (!isIterable(seeders)) return;
            const targetSocket = backEnd.sockets.get(seederId);
            if (!targetSocket) continue;
            targetSocket.emit("restartOrigin", `${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`);
        }
    });
    socket.on("setAuto", (enabled) => {
        if (typeof(enabled) !== "boolean") return;
        autoStatus = {
            "enabled":enabled,
            "user":`${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`,
            "timestamp":new Date().getTime(),
        };
        frontEnd.emit("autoUpdate", autoStatus);
        if ((new Date().getTime() - lastAutoTime) > 5000) setAutoTargets(BFGame.BF4);
    });
    next();
}
function checkAuthBackend(socket:socket.Socket, next) {
    if (!(socket.handshake.query.version) || (parseInt((<string>socket.handshake.query.version).split(".")[0]) !== apiVersion)) {
        next(new Error("OUTOFDATE"));
        return;
    }
    if (socket.handshake.query.token !== clientToken) {
        next(new Error("UNAUTHORIZED"));
        return;
    }
    next();
}
function registerSocketBackend(socket:socket.Socket, next) {
    if (!((typeof(socket.handshake.query.playerName) === "string") && (typeof(socket.handshake.query.version) === "string") && (typeof(socket.handshake.query.hostname) === "string"))) {
        next(new Error("INVALID"));
        return;
    }
    const initSeeder:SeederData = {
        username:socket.handshake.query.playerName,
        hostname:socket.handshake.query.hostname,
        stateBF4:(socket.handshake.query.hasBF4 === "true") ? GameState.IDLE : GameState.UNOWNED,
        stateBF1:(socket.handshake.query.hasBF1 === "true") ? GameState.IDLE : GameState.UNOWNED,
        targetBF4:emptyTarget(),
        targetBF1:emptyTarget(),
        version:socket.handshake.query.version,
    };
    seeders.set(socket.id, initSeeder);
    socket.on("gameStateUpdate", (game:BFGame, newState:GameState) => {
        if (!Object.values(GameState).includes(GameState[game])) return;
        if (game === BFGame.BF4) {
                seeders.get(socket.id)!.stateBF4 = newState;
        } else if (game === BFGame.BF1) {
                seeders.get(socket.id)!.stateBF1 = newState;
        } else return;
        frontEnd.emit("seederUpdate", socket.id, seeders.get(socket.id));
    });
    socket.on("disconnecting", () => {
        frontEnd.emit("seederGone", socket.id);
        seeders.delete(socket.id);
    });
    next();
}
// Verify target is real, and then set it. Returns true if successful, false if not.
async function verifyAndSetTarget(game:BFGame, seeders:Array<string>, newTarget:string | null, author?:string):Promise<boolean> {
    author = author || "System";
    if (autoStatus.enabled && (author !== autoName)) return false;
    if (game === BFGame.BF4) {
        let newTargetReq;
        if (newTarget) {
            if (!guidRegex.test(newTarget)) {
                return false;
            }
            newTargetReq = await (await fetch(`https://battlelog.battlefield.com/bf4/servers/show/PC/${newTarget}`, {
                "headers": {
                    "User-Agent": "Mozilla/5.0 SeederManager",
                    "Accept": "*/*",
                    "X-AjaxNavigation": "1",
                    "X-Requested-With": "XMLHttpRequest",
                },
                "method": "GET",
            })).json();
            if (newTargetReq.template === "errorpages.error404") {
                return false;
            }
        }
        const newTargetObj:ServerData = {
            "name": newTargetReq ? newTargetReq.context.server.name : null,
            "gameId": newTargetReq ? newTargetReq.context.server.gameId : null,
            "guid":newTarget,
            "user":author,
            "timestamp":new Date().getTime(),
        };
        setTarget(BFGame.BF4, seeders, newTargetObj);
        return true;
    }
    if (game === BFGame.BF1) {
        let newTargetReq:Response;
        let newTargetData:Record<string, any> | undefined;
        if (newTarget) {
            // Make sure gameid is length 13 and a number
            if (!((newTarget.length === 13) && !(isNaN(parseInt(newTarget))))) return false;
            newTargetReq = await fetch(`https://api.gametools.network/bf1/detailedserver/?gameid=${newTarget}&lang=en-us&platform=pc`, {
                "headers": {
                    "User-Agent": "Mozilla/5.0 SeederManager",
                    "Accept": "application/json",
                },
                "method": "GET",
            });
            newTargetData = await newTargetReq.json();
            if (newTargetReq.status !== 200) {
                return false;
            }
            if (!newTargetData) return false;
        }
        const newTargetObj:ServerData = {
            "name": newTargetData ? newTargetData.prefix : null,
            "gameId": newTarget,
            "guid": null,
            "user": author,
            "timestamp": new Date().getTime(),
        };
        setTarget(game, seeders, newTargetObj);
        return true;
    }
    return false;
}
// Set target, without any kind of verification.
function setTarget(game:BFGame, targetSeeders:Array<string>, newTarget:ServerData) {
    if (!isIterable(targetSeeders)) return;
    for (const seederId of targetSeeders) {
        const targetSocket = backEnd.sockets.get(seederId);
        const targetSeeder = seeders.get(seederId);
        if (!(targetSocket && targetSeeder && (targetSeeder[`state${BFGame[game]}`] !== GameState.UNOWNED))) continue;
        targetSeeder[`target${BFGame[game]}`] = newTarget;
        frontEnd.emit("seederUpdate", seederId, targetSeeder);
        targetSocket.emit("newTarget", game, newTarget);
    }
}
async function getServerPlayersBF4(serverId:string):Promise<[number, number]> {
    const serverReq = await fetch(`https://keeper.battlelog.com/snapshot/${serverId}`);
    let serverData;
    try {
        serverData = (await serverReq.json()).snapshot.teamInfo;
    } catch {
        return await getServerPlayersBF4(serverId);
    }
    let players = 0;
    let realPlayers = 0;
    const seederNames:Array<string> = [];
    for (const seeder of seeders.values()) {
        seederNames.push(seeder.username.toLowerCase());
    }
    for (const team in serverData) {
        players = players + Object.keys(serverData[team].players).length;
        for (const player in serverData[team].players) {
            const playerName = serverData[team].players[player].name;
            if (!(seederNames.includes(playerName.toLowerCase()))) realPlayers++;
        }
    }
    return [players, realPlayers];
}
async function getServerDataBF1(serverName:string):Promise<[number, number]> {
    const uriT = `https://api.gametools.network/bf1/detailedserver?name=${encodeURIComponent(serverName)}&lang=en-us&platform=pc`;
    const serverReq = await fetch(uriT);
    if (!serverReq.ok) {
        console.log(`Error fetching server information for server ${serverName}.`);
    }
    const serverData = await serverReq.json();
    return [serverData.playerAmount, serverData.gameId];
}
async function setAutoTargets(game:BFGame) {
    lastAutoTime = new Date().getTime();
    if (!autoStatus.enabled) return;
    const currentDate = new Date();
    const dayMinutes = currentDate.getUTCMinutes() + (currentDate.getUTCHours() * 60);
    // Maps server GUIDs to the seeders to send to it.
    const queuedActions:Map<string, Array<string>> = new Map();
    const playerCounts:Map<string, [number, number]> = new Map();
    const gameIds:Map<string, number> = new Map();
    // Get/Store server's total/real players.
    const servers = (game === BFGame.BF4) ? autoSettings.serversBF4 : autoSettings.serversBF1;
    for (const targetServer of servers) {
        if (game === BFGame.BF1) {
            const [totalPlayers, gameId] = await getServerDataBF1(targetServer.id);
            gameIds.set(targetServer.id, gameId);
        }
        playerCounts.set(targetServer.id, await getServerPlayersBF4(targetServer.id));
    }
    // Set after playercounts so we have accurate list of seeders.
    const availableSeeders = new Map(seeders);
    // Assign seeders to servers needing seeding
    for (const serverIndex of (game === BFGame.BF4) ? autoSettings.priorityToSeedBF4 : autoSettings.priorityToSeedBF1) {
        const targetServer = autoSettings.serversBF4[serverIndex];
        if (playerCounts.get(targetServer.id)![1] >= targetServer.seededPlayers || ((dayMinutes >= targetServer.deadIntervals[0]) && (dayMinutes <= targetServer.deadIntervals[1]))) continue;
        // Ensure serverActions exists and is in queuedActions.
        const serverActions = queuedActions.get(targetServer.id) || [];
        queuedActions.set(targetServer.id, serverActions);
        let neededPlayers = targetServer.seededPlayers - playerCounts.get(targetServer.id)![1];
        const serverSeeders:Array<string> = [];
        for (const [seederId, seeder] of seeders) {
            const seederTarget = (game === BFGame.BF4) ? seeder.targetBF4.guid : seeder.targetBF1.guid;
            if ((seederTarget === targetServer.id)) {
                serverSeeders.push(seederId);
            }
        }
        // Count the bots already on the server and prevent them from being stolen by servers of later priority.
        while ((serverSeeders.length > 0) && (neededPlayers > 0)) {
            availableSeeders.delete(serverSeeders[0]);
            serverSeeders.shift();
            neededPlayers--;
        }
        for (const [seederId] of availableSeeders) {
            if (neededPlayers <= 0) break;
            if (!seederId) continue;
            serverActions.push(seederId);
            availableSeeders.delete(seederId);
            neededPlayers--;
        }
    }
    for (const serverIndex of (game === BFGame.BF4) ? autoSettings.priorityToKeepAliveBF4 : autoSettings.priorityToKeepAliveBF1) {
        const targetServer = autoSettings.serversBF4[serverIndex];
        if ((playerCounts.get(targetServer.id)![1] >= targetServer.targetPlayers) || (playerCounts.get(targetServer.id)![1] <= targetServer.seededPlayers)) continue;
        // Ensure serverActions exists and is in queuedActions.
        const serverActions = queuedActions.get(targetServer.id) || [];
        queuedActions.set(targetServer.id, serverActions);
        let neededPlayers = targetServer.targetPlayers - playerCounts.get(targetServer.id)![1];
        const serverSeeders:Array<string> = [];
        for (const [seederId, seeder] of seeders) {
            const seederTarget = (game === BFGame.BF4) ? seeder.targetBF4.guid : seeder.targetBF1.guid;
            if ((seederTarget === targetServer.id)) {
                serverSeeders.push(seederId);
            }
        }
        // Count the bots already on the server and prevent them from being stolen by servers of later priority.
        while ((serverSeeders.length > 0) && (neededPlayers > 0)) {
            availableSeeders.delete(serverSeeders[0]);
            serverSeeders.shift();
            neededPlayers--;
        }
        for (const [seederId] of availableSeeders) {
            if (neededPlayers <= 0) break;
            if (!seederId) continue;
            serverActions.push(seederId);
            availableSeeders.delete(seederId);
            neededPlayers--;
        }
    }

    for (const [serverId, targetedSeeders] of queuedActions) {
        let serverIdToSend = serverId;
        if (game === BFGame.BF1) serverIdToSend = gameIds.get(serverId)!.toString();
        if (targetedSeeders.length === 0) continue;
        const autoMessage = `[AUTO] Assigning seeders\n\n${targetedSeeders}\n\nto server\n${serverId}`;
        frontEnd.emit("autoAssignment", autoMessage);
        verifyAndSetTarget(game, targetedSeeders, serverIdToSend, autoName);
    }
    if (availableSeeders.size !== 0) {
        const autoMessage = `[AUTO] Dropping seeders\n\n${Array.from(availableSeeders.keys())}\n\nfrom all servers.`;
        frontEnd.emit("autoAssignment", autoMessage);
        verifyAndSetTarget(game, Array.from(availableSeeders.keys()), null, autoName);
    }
}
/*async function serverCheck() {
    if (!autoEnabled) return;
    for (const [ index, server ] of servers.entries()) {
        const currentDate = new Date();
        const dayMinutes = currentDate.getUTCMinutes() + (currentDate.getUTCHours() * 60);
        for (const [seederId, seeder] of seeders) {
            if ((seeder.targetBF4.guid === server.guid) || (seeder.targetBF1.gameId === bf1GameId)) {
                serverSeeders.push(seederId);
            }
            if ((((game === BFGame.BF4) && ((seeder.targetBF4.gameId === null) || servers.map((ele) => {return ele.guid;}).indexOf(seeder.targetBF4.guid!) > index)) || ((game === BFGame.BF1) && (seeder.targetBF1.gameId === null))) && ((seeder[`target${BFGame[game]}`].user === autoName) || seeder[`state${BFGame[game]}`] === GameState.IDLE)) {
                emptySeeders.push(seederId);
            }
        }
        // If the current time is greater than the end seed time but less than the start seed time
        if (((dayMinutes >= server.deadIntervals[0]) && (dayMinutes <= server.deadIntervals[1])) && ((players - serverSeeders.filter((ele) => seeders.get(ele)![`state${BFGame[game]}`] === GameState.ACTIVE).length) < server.emptyThreshold)) {
            verifyAndSetTarget(game, serverSeeders, null, autoName);
            continue;
        }
        if ((players < server.targetPlayers) && (emptySeeders.length > 0)) {
            verifyAndSetTarget(game, emptySeeders.slice(0, (server.targetPlayers - players)), server.guid! || bf1GameId!, autoName);
        } else if ((players > server.targetPlayers) && (serverSeeders.length > 0))  {
            verifyAndSetTarget(game, serverSeeders.slice(0, (players - server.targetPlayers)), null, autoName);
        }
    }
}*/
function mapReplacer(key, value) {
    if(value instanceof Map) {
        return {
            dataType: "Map",
            value: Array.from(value.entries()),
        };
    } else {
        return value;
    }
}

// #endregion
// #region Helpers
function checkPermissions(session:ExpressSession.Session & Partial<ExpressSession.SessionData>):PermissionState {
    if (!((session.bearer_token) && (session.discordUser))) return PermissionState.NOT_LOGGED_IN;
    if ((!users.includes(session.discordUser.id))) return PermissionState.NOT_AUTHORIZED;
    return PermissionState.SUCCESS;
}
function emptyTarget():ServerData {
    return {
        "name":null,
        "guid":null,
        "gameId":null,
        "user":"System",
        "timestamp":new Date().getTime(),
    };
}
function isIterable(obj) {
    // checks for null and undefined
    if (obj == null) {
        return false;
    }
    return typeof obj[Symbol.iterator] === "function";
}
// #endregion
// #region Watchers
fs.watch(usersPath, async () => {
    const usersFile = await fs.promises.readFile(usersPath, {"encoding":"utf-8"});
    try {
        users = JSON.parse(usersFile);
    } catch {
        // Who cares?
    }
});
fs.watch(serversPath, async () => {
    const serversFile = await fs.promises.readFile(serversPath, {"encoding":"utf-8"});
    try {
        autoSettings = JSON.parse(serversFile);
    } catch {
    // Who cares?
    }
});
// #endregion
httpServer.listen(config.webPort);
console.log(`WebServer listening on port ${config.webPort}`);
