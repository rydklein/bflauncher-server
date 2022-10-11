// Imports
import http from "http";
import express from "express";
import { SeederData, ServerData, AutomationStatus, BFGame } from "./commonTypes";
import * as fs from "fs";
import ExpressSession from "express-session";
import FormData from "form-data";
import fetch, { Response } from "node-fetch";
import MemoryStore from "memorystore";
import path from "path";
import socket from "socket.io";
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
interface APIUser {
    username:string,
    ips:Array<string>,
    token:string
}
interface APISeeder extends SeederData {
    id:string
}
declare module "express-session" {
    export interface SessionData {
      bearer_token:string,
      discordUser:Record<string, any>,
    }
  }
//#endregion
// Global Variables
const config = JSON.parse(fs.readFileSync("./config/config.json", {"encoding":"utf-8"}));
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
const webInterface = express();
webInterface.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
webInterface.use(express.json());
webInterface.use(express.urlencoded({ extended: true }));
const httpServer = http.createServer(webInterface);
// #region Startup
const panelUsersPath = "./config/panelusers.json";
const apiUsersPath = "./config/apiusers.json";
let panelUsers:Array<string> = JSON.parse(fs.readFileSync(panelUsersPath, {"encoding":"utf-8"}));
let apiUsers:Array<APIUser> = JSON.parse(fs.readFileSync(apiUsersPath, {"encoding":"utf-8"}));
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
// #region Main Site
webInterface.get("/", async (req, res) => {
    // If not logged in, redirect to login page.
    const userData = checkPermsPanel(req.session);
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
    const userData = checkPermsPanel(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.status(401).send();
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/javascript");
    res.sendFile(path.join(__dirname, "/assets/main.js")); 
});
webInterface.get("/assets/sorttable.js", async (req, res) => {
    const userData = checkPermsPanel(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.status(401).send();
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/javascript");
    res.sendFile(path.join(__dirname, "/assets/sorttable.js")); 
});
webInterface.get("/assets/main.css", async (req, res) => {
    const userData = checkPermsPanel(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.status(401).send();
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/css");
    res.sendFile(path.join(__dirname, "/assets/main.css")); 
});
// #endregion
// #region API
webInterface.get("/api/getSeeders", async (req, res) => {
    const apiUser = checkPermsAPI(req, res);
    if (!apiUser) return;
    const apiSeeders:Array<APISeeder> = [];
    for (const [key, value] of seeders) {
        const newSeeder:any = {};
        Object.assign(newSeeder, value);
        newSeeder.id = key;
        apiSeeders.push(newSeeder);
    }
    res.json(apiSeeders);
});
webInterface.get("/api/getAuto", async (req, res) => {
    const apiUser = checkPermsAPI(req, res);
    if (!apiUser) return;
    res.json(autoStatus);
});
webInterface.post("/api/sendSeeders", async (req, res) => {
    const apiUser = checkPermsAPI(req, res);
    if (!apiUser) return;
    if (!req.body) {
        res.status(400).send("Missing body");
        return;
    }
    if (typeof req.body === "object" && req.body !== null && (req.body.game !== undefined) && req.body.seeders) {
        if (Array.isArray(req.body.seeders) && typeof req.body.game === "number") {
            const success = await verifyAndSetTarget(req.body.game, req.body.seeders, req.body.target, apiUser.username);
            res.status(200).send(success);
            return;
        }
    }
    res.status(400).send("Invalid body");
});
// #endregion
// #region Websockets
const clientToken = config.clientToken;
const seeders:Map<string, SeederData> = new Map();
const apiVersion:number = parseInt(JSON.parse(fs.readFileSync("./version.json", {"encoding":"utf-8"})).apiVersion);
const io:socket.Server = new socket.Server(httpServer);
const frontEnd:socket.Namespace = io.of("/ws/web");
const backEnd:socket.Namespace = io.of("/ws/seeder");
let autoStatus:AutomationStatus = {
    "enabled":false,
    "user":"SYSTEM",
    "timestamp":new Date().getTime(),
};
frontEnd.use((socket, next) => {
    sessionMiddleware(socket.request as any, {} as any, next as any);
});
// When a client connects, authenticate then set listeners for it.
frontEnd.use(checkAuthFrontend);
frontEnd.use(registerSocketFrontend);
backEnd.use(checkAuthBackend);
backEnd.use(registerSocketBackend);
function checkAuthFrontend(socket:socket.Socket, next) {
    const socketSession = socket.request["session"] as ExpressSession.Session & Partial<ExpressSession.SessionData>;
    const permsResult = checkPermsPanel(socketSession);
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
    -    socket.on("setAuto", (enabled) => {
        if (typeof(enabled) !== "boolean") return;
        autoStatus = {
            "enabled":enabled,
            "user":`${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`,
            "timestamp":new Date().getTime(),
        };
        frontEnd.emit("autoUpdate", autoStatus);
    });
    next();
}
function checkAuthBackend(socket:socket.Socket, next) {
    if (!(socket.handshake.query.version) || (parseInt((<string>socket.handshake.query.version).split(".")[0]) !== apiVersion)) {
        next(new Error("OUT_OF_DATE"));
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
        targetBF4:emptyTarget(BFGame.BF4),
        targetBF1:emptyTarget(BFGame.BF1),
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
    frontEnd.emit("seederUpdate", socket.id, seeders.get(socket.id));
    next();
}
// Verify target is real, and then set it. Returns true if successful, false if not.
async function verifyAndSetTarget(game:BFGame, seeders:Array<string>, newTarget:string | null, author?:string):Promise<boolean> {
    author = author || "System";
    if (game === BFGame.BF4) {
        let newTargetReq;
        if (newTarget != null) {
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
            "game": BFGame.BF4,
            "gameId": newTargetReq ? newTargetReq.context.server.gameId : null,
            "guid":newTarget,
            "user":author,
            "timestamp":new Date().getTime(),
        };
        setTarget(seeders, newTargetObj);
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
            "game": BFGame.BF1,
            "gameId": newTarget,
            "guid": null,
            "user": author,
            "timestamp": new Date().getTime(),
        };
        setTarget(seeders, newTargetObj);
        return true;
    }
    return false;
}
// Set target, without any kind of verification.
function setTarget(targetSeeders:Array<string>, newTarget:ServerData) {
    if (!isIterable(targetSeeders)) return;
    for (const seederId of targetSeeders) {
        const targetSocket = backEnd.sockets.get(seederId);
        const targetSeeder = seeders.get(seederId);
        if (!(targetSocket && targetSeeder && (targetSeeder[`state${BFGame[newTarget.game]}`] !== GameState.UNOWNED))) continue;
        targetSeeder[`target${BFGame[newTarget.game]}`] = newTarget;
        frontEnd.emit("seederUpdate", seederId, targetSeeder);
        targetSocket.emit("newTarget", newTarget);
    }
}
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
function checkPermsPanel(session:ExpressSession.Session & Partial<ExpressSession.SessionData>):PermissionState {
    if (!((session.bearer_token) && (session.discordUser))) return PermissionState.NOT_LOGGED_IN;
    if ((!panelUsers.includes(session.discordUser.id))) return PermissionState.NOT_AUTHORIZED;
    return PermissionState.SUCCESS;
}
function checkPermsAPI(req:express.Request, res:express.Response):APIUser | null {
    if(!(apiUsers.find(e => (e.ips.includes(req.ip))))) {
        console.log("Unauthorized IP: " + req.ip);
        res.status(403).send("Unauthorized IP " + (req.ip));
        return null;
    }
    if (!req.headers.authorization) {
        res.status(401).send("No token");
        return null;
    }
    if(!(apiUsers.find(e => (e.ips.includes(req.ip)))!.token == req.headers.authorization)) {
        console.log("Unauthorized Token by address " + req.ip);
        res.status(403).send("Invalid token");
        return null;
    }
    return apiUsers.find(e => (e.token == req.headers.authorization))!;
}
function emptyTarget(game:BFGame):ServerData {
    return {
        "name":null,
        "game":BFGame.BF4,
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
fs.watch(panelUsersPath, async () => {
    const usersFile = await fs.promises.readFile(panelUsersPath, {"encoding":"utf-8"});
    try {
        panelUsers = JSON.parse(usersFile);
    } catch {
        // Who cares?
    }
});
fs.watch(apiUsersPath, async () => {
    const usersFile = await fs.promises.readFile(apiUsersPath, {"encoding":"utf-8"});
    try {
        apiUsers = JSON.parse(usersFile);
    } catch {
        // Who cares?
    }
});
// #endregion
httpServer.listen(config.webPort);
console.log(`WebServer listening on port ${config.webPort}`);
