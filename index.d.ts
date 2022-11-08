/* eslint-disable no-unused-vars */
import NextAuth from "next-auth";
import {SiteUser} from "./utils/dbUtils";
declare module "next-auth" {
    interface Session extends NextAuth.Session {
        user:SiteUser,
        userName:string,
        userImage:string | null
    }
}