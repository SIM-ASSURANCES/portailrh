import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [], // Added in auth.ts because of bcrypt
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.fullName = user.fullName;
        token.role = user.role;
        token.photoUrl = user.photoUrl;
        token.tokenVersion = user.tokenVersion;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.fullName = token.fullName as string;
      session.user.photoUrl = token.photoUrl as string | null;
      session.user.tokenVersion = token.tokenVersion as number;
      session.role = token.role as string;
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isApiRoute = nextUrl.pathname.startsWith('/api');
      const isAuthRoute = nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/invitation');

      if (isApiRoute) {
        return true; // API routes handle their own auth
      }

      if (isAuthRoute) {
        return true;
      }

      if (!isLoggedIn) {
        return false; // Redirects to login
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
