// 集中环境变量配置（PRD 三章：API Key、数据库连接串、队列连接串必须通过环境变量配置）

// 数据库连接（Prisma 从 .env 读取）
export const DATABASE_URL = process.env.DATABASE_URL || '';

// 从连接串解析 schema（原生 SQL 需显式加 schema 前缀，$executeRawUnsafe 不继承 Prisma 的 schema 处理）
export function resolveDbSchema(url: string): string {
  try {
    const u = new URL(url);
    return u.searchParams.get('schema') || 'public';
  } catch {
    return 'public';
  }
}
export const DB_SCHEMA = resolveDbSchema(DATABASE_URL);

// Redis 队列（生产必填；本地开发可用 Upstash 或本地 Redis）
export const REDIS_URL = process.env.REDIS_URL || '';

// 文件存储
export const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local'; // local | s3
export const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT || '';
export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || '';
export const STORAGE_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY || '';
export const STORAGE_SECRET_KEY = process.env.STORAGE_SECRET_KEY || '';

// v2 兼容接口鉴权（未配置时拒绝所有请求，禁止默认密钥）
export const V2_API_KEY = process.env.V2_API_KEY || '';

// 队列是否可用
export function isQueueAvailable(): boolean {
  return !!REDIS_URL;
}

// 上传文件大小上限（与 /api/upload 保持一致）
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

// SKU 校验降级阈值：SKU 主数据查询超过该毫秒数进入降级模式（PRD 模块十）
export const SKU_VALIDATE_TIMEOUT_MS = 3000;
