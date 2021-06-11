// Imports
import https from "https";
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
const config = JSON.parse(fs.readFileSync("./config.json", {"encoding":"utf-8"}));
const webInterface = express();
const httpsServer = https.createServer({
    key: fs.readFileSync("cert.key"),
    cert: fs.readFileSync("cert.pem"),
}, webInterface);
// #region Startup
const usersPath = "./users.json";
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
        "secure": true,
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
webInterface.get("/main.js", async (req,res) => {
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
    public seeders: Map<string, SeederStorage> = new Map();
    public currentTarget:ServerData = {
        "name":null,
        "guid":null,
        "user":"System",
        "timestamp":new Date().getTime(),
    };
    constructor(webServer:https.Server, authMiddleware:express.RequestHandler, checkPerms:any, clientToken:string) {
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
            if(checkPerms(socketSession) !== PermissionState.SUCCESS) {
                socket.disconnect(true);
            }
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
            callback(JSON.stringify(this.seeders, Websockets.mapReplacer));
        });
        socket.on("setTarget", async (targetGUID, callback) => {
            const success = await this.verifyAndSetTarget(targetGUID, `${socket.request["session"].discordUser.username}#${socket.request["session"].discordUser.discriminator}`);
            callback(success);
        });
        socket.on("getTarget", (callback) => {
            callback(this.currentTarget);
        });
    }
    private registerEventsBackend(socket:socket.Socket) {
        socket.on("gameStateUpdate", (newState:string) => {
            this.updateSeederDisplay(socket.handshake.auth.hostname, newState);
        });
        socket.on("getTarget", (callback) => {
            callback(this.currentTarget);
        });
        socket.on("disconnect", () => {
            this.updateSeederDisplay(socket.handshake.auth.hostname, null);
        });
    }
    // Verify target is real, and then set it. Returns true if successful, false if not.
    public async verifyAndSetTarget(newTarget:string | null, author?:string):Promise<boolean> {
        author = author || "System";
        let newTargetReq;
        if (newTarget) {
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
        this.setTarget(newTargetObj);
        return true;
    }
    // Set target, without any kind of verification.
    private setTarget(newTarget:ServerData) {
        if (this.currentTarget.guid === newTarget.guid) return;
        this.currentTarget = newTarget;
        this.frontEnd.emit("newTarget", newTarget);
        this.backEnd.emit("newTarget", newTarget);
    }
    private updateSeederDisplay(hostname:string, newState:string | null) {
        if(!newState) {
            this.seeders.delete(hostname);
        } else {
            const seederData:SeederStorage = {
                "state":newState,
                "timestamp":Date.now(),
            };  
            this.seeders.set(hostname, seederData);
        }
        this.frontEnd.emit("seederUpdate", hostname, newState);
    }
    public static mapReplacer(key, value) {
        if(value instanceof Map) {
            return {
                dataType: "Map",
                value: Array.from(value.entries()), // or with spread: value: [...value]
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
fs.watch("./users.json", async () => {
    users = JSON.parse(await fs.promises.readFile(usersPath, {"encoding":"utf-8"}));
});
// #endregion
new Websockets(httpsServer, sessionMiddleware, checkPermissions, config.clientToken);
httpsServer.listen(config.webPort);
console.log(`Secure WebServer listening on port ${config.webPort}`);