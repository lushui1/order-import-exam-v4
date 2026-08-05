import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';

// 允许的文件扩展名
const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xls', 'docx', 'pdf']);
// 单文件大小上限 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 文件名消毒：只保留 basename，并去除路径分隔符与不可见字符
function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName);
  // 去掉控制字符与可能引发问题的字符，仅保留常规文件名字符
  return base.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_');
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const ruleId = formData.get('ruleId') as string | null;

    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

    // 校验文件大小
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '文件超过大小限制（最大 10MB）' },
        { status: 413 }
      );
    }

    // 校验扩展名
    const rawName = file.name || '';
    const ext = rawName.toLowerCase().split('.').pop() || '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `不支持的文件格式: .${ext}，仅支持 xlsx/xls/docx/pdf` },
        { status: 400 }
      );
    }

    const fileName = sanitizeFileName(rawName);

    // 检查是否在5分钟内有相同文件名的导入
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingImport = await prisma.import.findFirst({
      where: {
        fileName,
        createdAt: { gte: fiveMinutesAgo },
        status: { in: ['pending', 'parsing', 'parsed'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingImport) {
      // 返回已存在的导入记录
      return NextResponse.json({
        importId: existingImport.id,
        fileName: existingImport.fileName,
        fileSize: 0,
        isDuplicate: true,
      });
    }

    // 读取文件
    const buffer = Buffer.from(await file.arrayBuffer());

    // 创建导入记录
    const importRecord = await prisma.import.create({
      data: {
        fileName,
        ruleId: ruleId || null,
        status: 'pending',
      },
    });

    // 保存文件到临时目录
    const uploadDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadDir, `${importRecord.id}_${fileName}`);
    try {
      await mkdir(uploadDir, { recursive: true });
      await writeFile(filePath, buffer);
    } catch (err) {
      // 写盘失败时清理孤儿记录，避免留下无文件的导入
      await prisma.import.delete({ where: { id: importRecord.id } }).catch(() => {});
      console.error('文件保存失败:', err);
      return NextResponse.json({ error: '文件保存失败，请重试' }, { status: 500 });
    }

    return NextResponse.json({
      importId: importRecord.id,
      fileName,
      fileSize: buffer.length,
      filePath: `/uploads/${importRecord.id}_${fileName}`,
    });
  } catch (error: any) {
    console.error('上传接口异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}
