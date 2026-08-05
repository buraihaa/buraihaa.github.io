// Carry the username on the JWT so the session/middleware can read it.
import "next-auth/jwt";

declare module "next-auth/jwt" {
  interface JWT {
    username?: string;
  }
}
