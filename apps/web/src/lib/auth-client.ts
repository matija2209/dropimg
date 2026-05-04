import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
    // In production, the backend and frontend are often on the same domain
    // If VITE_API_URL is not set, it defaults to the current origin
    baseURL: import.meta.env.VITE_API_URL || window.location.origin,
    plugins: [
        adminClient()
    ]
});

export const { useSession, signIn, signOut } = authClient;
