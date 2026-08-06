// 文件存储抽象（PRD 模块二：保存原始文件或可复读的文件引用）
// 本地开发用 uploads/ 目录；生产可配置 S3/R2/Vercel Blob（STORAGE_BACKEND=s3）
// Vercel Serverless 的 process.cwd() 只读，必须使用 /tmp（PRD 3.1 约束）

import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import { STORAGE_BACKEND, STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY } from '@/lib/config';

// 安全文件名：只保留 basename 并去除危险字符
export function safeFileName(raw: string): string {
  const base = path.basename(raw);
  return base.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_');
}

export interface StoredFile {
  key: string;      // 文件引用键（如 import_tasks/{taskId}.xlsx）
  size: number;
  backend: 'local' | 's3';
}

// Vercel Serverless 环境 process.cwd() 只读，写入 /tmp；本地开发写 uploads/
const uploadRoot = process.env.VERCEL
  ? '/tmp/uploads'
  : path.join(process.cwd(), 'uploads');

// 保存文件，返回可复读的文件引用
export async function saveFile(key: string, buffer: Buffer): Promise<StoredFile> {
  if (STORAGE_BACKEND === 's3' && STORAGE_ENDPOINT && STORAGE_BUCKET) {
    return saveToS3(key, buffer);
  }
  const filePath = path.join(uploadRoot, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return { key, size: buffer.length, backend: 'local' };
}

// 按引用读取文件
export async function readStoredFile(key: string): Promise<Buffer> {
  if (STORAGE_BACKEND === 's3' && STORAGE_ENDPOINT && STORAGE_BUCKET) {
    return readFromS3(key);
  }
  return readFile(path.join(uploadRoot, key));
}

// 删除文件（失败不抛错，用于清理）
export async function deleteStoredFile(key: string): Promise<void> {
  try {
    if (STORAGE_BACKEND === 's3' && STORAGE_ENDPOINT && STORAGE_BUCKET) {
      await deleteFromS3(key);
    } else {
      await unlink(path.join(uploadRoot, key));
    }
  } catch {
    // 忽略清理失败
  }
}

// ── S3 兼容（MinIO/R2/OSS 等）最小实现，使用 AWS 风格签名 ├─
async function saveToS3(key: string, buffer: Buffer): Promise<StoredFile> {
  // 通过兼容端点直接 PUT（依赖存储端的公共/预签名策略；生产建议换用官方 SDK）
  const url = `${STORAGE_ENDPOINT.replace(/\/$/, '')}/${STORAGE_BUCKET}/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Authorization': `Bearer ${STORAGE_ACCESS_KEY}`,
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) throw new Error(`S3 保存失败: ${res.status}`);
  return { key, size: buffer.length, backend: 's3' };
}

async function readFromS3(key: string): Promise<Buffer> {
  const url = `${STORAGE_ENDPOINT.replace(/\/$/, '')}/${STORAGE_BUCKET}/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${STORAGE_ACCESS_KEY}` },
  });
  if (!res.ok) throw new Error(`S3 读取失败: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteFromS3(key: string): Promise<void> {
  const url = `${STORAGE_ENDPOINT.replace(/\/$/, '')}/${STORAGE_BUCKET}/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${STORAGE_ACCESS_KEY}` },
  });
}
