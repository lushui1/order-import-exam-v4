/**
 * PRD 8.3 查询错误明细：GET /api/import-tasks/:taskId/errors
 * 支持 batch / error_code 筛选 + 分页（page, page_size）
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { searchParams } = new URL(req.url);

    const batchRaw = parseInt(searchParams.get('batch') || '', 10);
    const errorCode = searchParams.get('error_code');
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawPageSize = parseInt(searchParams.get('page_size') || '50', 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 50;

    const where: any = { taskId };
    if (Number.isFinite(batchRaw)) where.batchIndex = batchRaw;
    if (errorCode) where.errorCode = errorCode;

    const [errors, total] = await Promise.all([
      prisma.importTaskError.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.importTaskError.count({ where }),
    ]);

    return NextResponse.json({
      task_id: taskId,
      errors: errors.map(e => ({
        id: e.id,
        unit_id: e.unitId,
        batch_index: e.batchIndex,
        row_number: e.rowNumber,
        field_name: e.fieldName,
        raw_value: e.rawValue, // 敏感字段已脱敏
        error_code: e.errorCode,
        error_reason: e.errorReason,
        trace_id: e.traceId,
        created_at: e.createdAt.toISOString(),
      })),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    console.error('查询错误明细异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}
