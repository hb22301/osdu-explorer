import "express-session";

declare module "express-session" {
  interface SessionData {
    osduConfig?: {
      baseUrl: string;
      partitionId: string;
      tokenEndpoint: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
    };
  }
}
