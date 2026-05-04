import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { admin } from "better-auth/plugins";
import { config } from "../config.js";
import { count } from "drizzle-orm";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "sqlite",
        schema: {
            user: schema.user,
            session: schema.session,
            account: schema.account,
            verification: schema.verification,
        },
    }),
    emailAndPassword: {
        enabled: true,
        async isSignUpAllowed() {
            return true;
        }
    },
    databaseHooks: {
        user: {
            create: {
                before: async (user) => {
                    const [result] = await db.select({ value: count() }).from(schema.user);
                    if (result.value === 0) {
                        return {
                            data: {
                                ...user,
                                role: "admin"
                            }
                        };
                    }
                    return { data: user };
                }
            }
        }
    },
    plugins: [
        admin()
    ],
    advanced: {
        useSecureCookies: true,
        trustProxy: true,
        trustedOrigins: [
            config.appUrl, 
            config.auth.url,
            "https://img.buildwithmatija.com",
            "http://img.buildwithmatija.com"
        ],
    },
    secret: config.auth.secret,
    baseURL: config.auth.url,
});
