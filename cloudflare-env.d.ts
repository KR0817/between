declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPERATOR_EMAIL?: string;
    MAINTENANCE_TOKEN?: string;
  }
}
