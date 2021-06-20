// Imports
import http from "http";
import express from "express";
import ejs from "ejs";
import "colors";
import * as fs from "fs";
import ExpressSession from "express-session";
import FormData from "form-data";
import fetch from "node-fetch";
import MemoryStore from "memorystore";
import path from "path";
import socket from "socket.io";
//#region Types
enum PermissionState {
    "SUCCESS",
    "NOT_LOGGED_IN",
    "NOT_AUTHORIZED"
}
type SeederStorage = {
    state: string,
    timestamp: number
}
type ServerData = {
    "name":string | null,
    "guid":string | null,
    "user":string,
    "timestamp":number
}

//#endregion
// Global Variables
const config = JSON.parse(fs.readFileSync("./config/config.json", {"encoding":"utf-8"}));
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
const webInterface = express();
const httpServer = http.createServer(webInterface);
// #region Startup
const usersPath = "./config/users.json";
let users: Array<string> = JSON.parse(fs.readFileSync(usersPath, {"encoding":"utf-8"}));
// #endregion
// #region Client <-> Server
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
// #region Frontend
webInterface.get("/", async (req, res) => {
    // If not logged in, redirect to login page.
    const userData = checkPermissions(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.redirect("/login");
    if (userData === PermissionState.NOT_AUTHORIZED) return res.redirect("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const html = await renderFilePromise("./assets/control.ejs", {"discordUser": req.session.discordUser}, {});
    res.send(html);
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
webInterface.get("/assets/main.js", async (req,res) => {
    const userData = checkPermissions(req.session);
    if (userData === PermissionState.NOT_LOGGED_IN) return res.redirect("/login");
    if (userData === PermissionState.NOT_AUTHORIZED) return res.status(403).send();
    res.set("Content-Type", "text/javascript");
    res.sendFile(path.join(__dirname + "/assets/main.js")); 
});
// #endregion
// #region Websockets
class Websockets {
    private io:socket.Server;
    private frontEnd:socket.Namespace;
    private backEnd:socket.Namespace;
    public seeders: Map<string, Record<string, SeederStorage>> = new Map();
    public currentTarget:Record<string, ServerData> = {
        "BF4": {
            "name":null,
            "guid":null,
            "user":"System",
            "timestamp":new Date().getTime(),
        },
        "BF1": {
            "name":null,
            "guid":null,
            "user":"System",
            "timestamp":new Date().getTime(),
        },
    }
    constructor(webServer:http.Server, authMiddleware:express.RequestHandler, checkPerms:any, clientToken:string) {
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
            this.registerEventsBackend(socket);
        });
    }
    // Register events; called when sockets connect.
    private registerEventsFrontend(socket:socket.Socket) {
        socket.on("getSeeders", (callback) => {
            if (typeof callback !== "function") return;
            callback(JSON.stringify(this.seeders, Websockets.mapReplacer));
        });
        socket.on("setTarget", async (game, newTarget:string, callback) => {
            if (typeof callback !== "function") return;
            const success = await this.verifyAndSetTarget(game, newTarget, `${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`);
            callback(success);
        });
        // No option for game selector since the only time this endpoint is used
        // Is when initializing the website, and both will be needed.
        socket.on("getTarget", (callback) => {
            if (typeof callback !== "function") return;
            callback(this.currentTarget);
        });
    }
    private registerEventsBackend(socket:socket.Socket) {
        socket.on("gameStateUpdate", (newState:string) => {
            this.updateSeederDisplay(socket.handshake.auth.hostname, "BF4", newState);
        });
        socket.on("oneStateUpdate", (newState:string) => {
            this.updateSeederDisplay(socket.handshake.auth.hostname, "BF1", newState);
        });
        socket.on("getTarget", (callback) => {
            if (typeof callback !== "function") return;
            callback(this.currentTarget);
        });
        socket.on("disconnect", () => {
            this.updateSeederDisplay(socket.handshake.auth.hostname, null, null);
        });
    }
    // Verify target is real, and then set it. Returns true if successful, false if not.
    public async verifyAndSetTarget(game:string, newTarget:string | null, author?:string):Promise<boolean> {
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
            this.setTarget("BF4", newTargetObj);
            return true;
        }
        if (game === "BF1") {
            let newTargetReq;
            if (newTarget) {
                // Make sure gameid is length 13 and a number
                if (!((newTarget.length === 13) && !(isNaN(parseInt(newTarget))))) return false;
                newTargetReq = await (await fetch(`https://api.gametools.network/bf1/detailedserver/?gameid=${newTarget}&lang=en-us&platform=pc`, {
                    "headers": {
                        "User-Agent": "Mozilla/5.0 SeederManager",
                        "Accept": "application/json",
                    },
                    "method": "GET",
                })).json();
                if (newTargetReq.error) {
                    return false;
                }
            }
            const newTargetObj:ServerData = {
                "name": newTargetReq ? newTargetReq.prefix : null,
                "guid":newTarget,
                "user":author,
                "timestamp":new Date().getTime(),
            };
            this.setTarget("BF1", newTargetObj);
            return true;
        }
        return false;
    }
    // Set target, without any kind of verification.
    private setTarget(game: string, newTarget:ServerData) {
        if (this.currentTarget[game].guid === newTarget.guid) return;
        this.currentTarget[game] = newTarget;
        this.frontEnd.emit("newTarget", game, newTarget);
        this.backEnd.emit("newTarget", game, newTarget);
    }
    private updateSeederDisplay(hostname:string, game:string | null, newState:string | null) {
        let newSeederState;
        if(!(game && newState)) {
            this.seeders.delete(hostname);
        } else {
            const seederData:SeederStorage = {
                "state":newState,
                "timestamp":Date.now(),
            };  
            newSeederState = this.seeders.get(hostname);
            if (!newSeederState) {
                newSeederState = {
                    [game]: seederData,
                };
            } else {
                newSeederState[game] = seederData;
            }
            this.seeders.set(hostname, newSeederState);
        }
        this.frontEnd.emit("seederUpdate", hostname, game, newState);
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
function renderFilePromise(filename:string, data:Record<string, unknown>, options:ejs.Options):Promise<string> {
    return new Promise((resolve, reject) => {
        ejs.renderFile(filename, data, options, function(err, str){
            if (err) reject(err);
            resolve(str);
        });
    }
    );
}
function checkPermissions(session:ExpressSession.Session & Partial<ExpressSession.SessionData>): PermissionState {
    if (!((session.bearer_token) && (session.discordUser))) return PermissionState.NOT_LOGGED_IN;
    if ((!users.includes(session.discordUser.id))) return PermissionState.NOT_AUTHORIZED;
    return PermissionState.SUCCESS;
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