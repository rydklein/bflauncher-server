import { MongoClient } from "mongodb";
import * as mongoose from "mongoose";
const uri = process.env.MONGODB_URI!;
let client:MongoClient;
let siteUserSchema: mongoose.Schema<ISiteUser, mongoose.Model<ISiteUser, any, any, any, any>, {}, {}, {}, {}, "type", ISiteUser>;
let SiteUser: mongoose.Model<ISiteUser, {}, {}, {}, any>;
export let clientPromise:Promise<MongoClient>;
// Shitty code. Refactor when not exhausted.
if (process.env.NODE_ENV === "development") {
    client = global.client || (global.client = new MongoClient(uri));
    clientPromise = global._mongoClientPromise || (global._mongoClientPromise = client.connect());
    siteUserSchema = global.siteUserSchema || (global.siteUserSchema = new mongoose.Schema<ISiteUser>({
        authId: { type: String, required: true },
        discordId: { type: String, required: true },
    }));
    SiteUser = global.siteUser || (global.siteUser = mongoose.model<ISiteUser>("SiteUser", siteUserSchema));
} else {
    client = new MongoClient(uri);
    clientPromise = client.connect();
    siteUserSchema = new mongoose.Schema<ISiteUser>({
        authId: { type: String, required: true },
        discordId: { type: String, required: true },
    });
    SiteUser = mongoose.model<ISiteUser>("SiteUser", siteUserSchema);
}
if (!(mongoose.connection.getClient() == client)) {
    mongoose.connection.setClient(client);
}

interface ISiteUser {
    authId: string,
    discordId: string
}


export async function setUser(authId: string, discordId: string) {
    if (!(await SiteUser.findOne({authId: authId, discordId:discordId}))) {
        await (new SiteUser({authId:authId, discordId:discordId})).save();
    }
}
export async function getUser(authId: string):Promise<ISiteUser | null> {
    const siteUser = await SiteUser.findOne({authId: authId});
    if (!siteUser) return null;
    return {
        authId: siteUser.authId,
        discordId: siteUser.discordId,
    };
}