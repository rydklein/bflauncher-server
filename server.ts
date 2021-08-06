// Imports
import http from "http";
import express from "express";
import { SeederData, ServerData } from "./commonTypes";
import "colors";
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
//#endregion
// Global Variables
const config = JSON.parse(fs.readFileSync("./config/config.json", {"encoding":"utf-8"}));
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
const webInterface = express();
const httpServer = http.createServer(webInterface);
const emptyTarget = {
    "name":null,
    "guid":null,
    "user":"System",
    "timestamp":new Date().getTime(),
};
// #region Startup
const usersPath = "./config/users.json";
let users:Array<string> = JSON.parse(fs.readFileSync(usersPath, {"encoding":"utf-8"}));
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
class Websockets {
    public seeders:Map<string, SeederData> = new Map();
    public apiVersion:number;
    private io:socket.Server;
    private frontEnd:socket.Namespace;
    private backEnd:socket.Namespace;
    private clientSockets:Array<socket.Socket> = [];
    constructor(webServer:http.Server, authMiddleware:express.RequestHandler, checkPerms:any, clientToken:string) {
        this.apiVersion = parseInt(JSON.parse(fs.readFileSync("./version.json", {"encoding":"utf-8"})).apiVersion);
        this.io = new socket.Server(webServer);
        this.frontEnd = this.io.of("/ws/web");
        this.backEnd = this.io.of("/ws/seeder");
        // Set Session Handler
        this.frontEnd.use((socket, next) => {
            authMiddleware(socket.request as any, {} as any, next as any);
        });
        // When a client connects, authenticate then set listeners for it.
        this.frontEnd.on("connection", (socket) => {
            const socketSession = socket.request["session"] as ExpressSession.Session & Partial<ExpressSession.SessionData>;
            if(checkPerms(socketSession) !== PermissionState.SUCCESS) return socket.disconnect(true);
            this.registerEventsFrontend(socket);
        });
        this.backEnd.on("connection", async (socket) => {
            if (socket.handshake.auth.token !== clientToken) return socket.disconnect(true);
            if (parseInt((<string>socket.handshake.auth.version).split(".")[0]) !== this.apiVersion) {
                socket.emit("outOfDate");
                socket.disconnect(true);
                return;
            }
            const initSeeder:SeederData = {
                username:socket.handshake.auth.playerName,
                hostname:socket.handshake.auth.hostname,
                stateBF4:socket.handshake.auth.hasBF4 ? "IDLE" : "UNOWNED",
                stateBF1:socket.handshake.auth.hasBF1 ? "IDLE" : "UNOWNED",
                targetBF4:emptyTarget,
                targetBF1:emptyTarget,
                lastUpdate:new Date().getTime(),
            };
            this.seeders.set(socket.id, initSeeder);
            this.frontEnd.emit("seederUpdate", socket.id, initSeeder);
            this.registerEventsBackend(socket);
        });
    }
    // Register events; called when sockets connect.
    private registerEventsFrontend(socket:socket.Socket) {
        socket.on("getSeeders", (callback) => {
            if (typeof callback !== "function") return;
            callback(JSON.stringify(this.seeders, Websockets.mapReplacer));
        });
        socket.on("setTarget", async (game, seeders:Array<string>, newTarget:string, callback) => {
            if (typeof callback !== "function") return;
            const success = await this.verifyAndSetTarget(game, seeders, newTarget, `${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`);
            callback(success);
        });
        socket.on("restartOrigin", (seeders:Array<string>) => {
            if (!isIterable(seeders)) return;
            for (const seederId of seeders) {
                const targetSocket = this.backEnd.sockets.get(seederId);
                if (!targetSocket) continue;
                targetSocket.emit("restartOrigin", `${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`);
            }
        });
    }
    private registerEventsBackend(socket:socket.Socket) {
        socket.on("gameStateUpdate", (game:string, newState:string) => {
            if (game === "BF4") {
                this.seeders.get(socket.id)!.stateBF4 = newState;
            } else if (game === "BF1") {
                this.seeders.get(socket.id)!.stateBF1 = newState;
            }
            this.frontEnd.emit("seederUpdate", socket.id, this.seeders.get(socket.id));
        });
        socket.on("disconnecting", () => {
            this.frontEnd.emit("seederGone", socket.id);
            this.seeders.delete(socket.id);
        });
    }
    // Verify target is real, and then set it. Returns true if successful, false if not.
    public async verifyAndSetTarget(game:string, seeders:Array<string>, newTarget:string | null, author?:string):Promise<boolean> {
        author = author || "System";
        if (game === "BF4") {
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
                "guid":newTarget,
                "user":author,
                "timestamp":new Date().getTime(),
            };
            this.setTarget("BF4", seeders, newTargetObj);
            return true;
        }
        if (game === "BF1") {
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
                "guid":newTarget,
                "user":author,
                "timestamp":new Date().getTime(),
            };
            this.setTarget("BF1", seeders, newTargetObj);
            return true;
        }
        return false;
    }
    // Set target, without any kind of verification.
    private setTarget(game:string, seeders:Array<string>, newTarget:ServerData) {
        if (!isIterable(seeders)) return;
        for (const seederId of seeders) {
            const targetSocket = this.backEnd.sockets.get(seederId);
            const targetSeeder = this.seeders.get(seederId);
            if (!(targetSocket && targetSeeder && (targetSeeder[`state${game}`] !== "UNOWNED"))) continue;
            targetSeeder[`target${game}`] = newTarget;
            this.frontEnd.emit("seederUpdate", seederId, targetSeeder);
            targetSocket.emit("newTarget", game, newTarget);
        }
    }
    public static mapReplacer(key, value) {
        if(value instanceof Map) {
            return {
                dataType: "Map",
                value: Array.from(value.entries()),
            };
        } else {
            return value;
        }
    }
}

// #endregion
// #region Helpers
function checkPermissions(session:ExpressSession.Session & Partial<ExpressSession.SessionData>):PermissionState {
    if (!((session.bearer_token) && (session.discordUser))) return PermissionState.NOT_LOGGED_IN;
    if ((!users.includes(session.discordUser.id))) return PermissionState.NOT_AUTHORIZED;
    return PermissionState.SUCCESS;
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
    users = JSON.parse(usersFile);
});
// #endregion
new Websockets(httpServer, sessionMiddleware, checkPermissions, config.clientToken);
httpServer.listen(config.webPort);
console.log(`WebServer listening on port ${config.webPort}`);