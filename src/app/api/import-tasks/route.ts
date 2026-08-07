/**
 * PRD 8.1 上传接口：POST /api/import-tasks
 * 职责：接收文件 + 创建任务 + 写入 Outbox（同事务）+ 返回 task_id，≤1s，不同步执行导入
 */
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createImportTask } from '@/lib/import-task-service';
import { safeFileName } from '@/lib/storage';
import { MAX_UPLOAD_SIZE } from '@/lib/config';

const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xls', 'docx', 'pdf']);

// 预扫描：快速识别总行数（xlsx/xls 读取首个 sheet 的行数；docx/pdf 返回 0，由 Worker 完成后更新）
// 性能：只读模式下仅需行数，关闭公式/样式/日期解析与单元格对象（dense 数组），显著降低上传内耗
function estimateTotalRows(buffer: Buffer, ext: string): number {
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const wb = XLSX.read(buffer, {
        type: 'buffer',
        cellFormula: false,
        cellStyles: false,
        cellDates: false,
        cellNF: false,
        dense: true, // 稀疏对象 → 密集数组，解析更快
      });
      const firstSheet = wb.SheetNames[0];
      if (firstSheet) {
        const ws = wb.Sheets[firstSheet];
        if (ws?.['!ref']) {
          const range = XLSX.utils.decode_range(ws['!ref']);
          return range.e.r + 1; // 行数（含表头）
        }
      }
    } catch {
      // 预扫描失败不阻塞任务创建，Worker 会重新解析
    }
  }
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const ruleId = (formData.get('ruleId') as string | null) || null;

    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

    // 大小限制
    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: '文件超过大小限制（最大 10MB）' }, { status: 413 });
    }

    // 扩展名白名单
    const rawName = file.name || '';
    const ext = rawName.toLowerCase().split('.').pop() || '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `不支持的文件格式: .${ext}，仅支持 xlsx/xls/docx/pdf` },
        { status: 400 }
      );
    }

    const fileName = safeFileName(rawName);
    const buffer = Buffer.from(await file.arrayBuffer());

    // 预扫描行数
    const estimatedRows = estimateTotalRows(buffer, ext);

    // 创建任务 + 批次 + Outbox（同事务），上传接口不做全量解析
    const result = await createImportTask(fileName, buffer, ruleId, estimatedRows);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('创建导入任务异常:', error);
    return NextResponse.json({ error: '任务创建失败，请稍后重试' }, { status: 500 });
  }
}
