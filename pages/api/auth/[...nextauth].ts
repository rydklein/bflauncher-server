import DiscordProvider, { DiscordProfile } from "next-auth/providers/discord";
import * as dbUtils from "../../../utils/dbUtils";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import NextAuth from "next-auth";

export default NextAuth({
    adapter: MongoDBAdapter(dbUtils.clientPromise),
    secret: process.env.NEXTAUTH_SECRET,
    callbacks: {
        async signIn({ user, profile }) {
            console.log(profile);
            if (profile && "id" in profile) {
                const profileCast = profile as DiscordProfile;
                await dbUtils.setUser(user.id, profileCast.id);
            }
            return true;
        },
        async session({ session, user }) {
            session.user = await dbUtils.getUser(user.id);
            session.userImage = user.image || null;
            session.userName = user.name!;
            return session;
        },
    },
    providers: [
        DiscordProvider({
            clientId: process.env.DISCORD_CLIENT_ID!,
            clientSecret: process.env.DISCORD_CLIENT_SECRET!,
            authorization: { params: { scope: "identify" } },
        }),
    ],
});