import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateOrderRow } from '@/lib/rule-engine/validation';

// 前端提交的行数据（服务端权威校验，不信任客户端）
interface SubmitRow {
  rowIndex: number;
  data: Record<string, string>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { importId, rows } = body;

    if (!importId) {
      return NextResponse.json({ error: '缺少导入ID' }, { status: 400 });
    }

    // 支持两种提交方式：
    // 1. 带 rows：前端编辑后的全量行数据，事务内替换
    // 2. 不带 rows：仅校验并提交已解析数据（兼容旧调用）
    if (Array.isArray(rows)) {
      return await submitWithRows(importId, rows);
    }

    // 旧方式：检查是否有错误行
    const errorCount = await prisma.order.count({
      where: { importId, hasError: true },
    });

    if (errorCount > 0) {
      return NextResponse.json({
        error: `还有 ${errorCount} 条错误数据，请先修正后再提交`,
      }, { status: 400 });
    }

    // 条件更新防重入：仅允许从 parsed 状态提交
    const updated = await prisma.import.updateMany({
      where: { id: importId, status: 'parsed' },
      data: { status: 'submitted' },
    });

    if (updated.count === 0) {
      const existing = await prisma.import.findUnique({ where: { id: importId } });
      if (!existing) {
        return NextResponse.json({ error: '导入记录不存在' }, { status: 404 });
      }
      return NextResponse.json({ error: '导入状态不允许提交（可能已提交）' }, { status: 409 });
    }

    const totalRows = await prisma.order.count({ where: { importId } });

    return NextResponse.json({
      success: true,
      totalRows,
      message: `成功提交 ${totalRows} 条运单`,
    });
  } catch (error: any) {
    console.error('提交接口异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}

// 带行数据的提交：事务内替换订单 + 更新状态，保证与前端所见一致
async function submitWithRows(importId: string, rows: SubmitRow[]) {
  // 服务端权威校验每一行
  const validated = rows.map(row => ({
    ...row,
    errors: validateOrderRow(row.data),
  }));
  const errorRows = validated.filter(r => r.errors.length > 0).length;

  if (errorRows > 0) {
    return NextResponse.json({
      error: `还有 ${errorRows} 条错误数据，请先修正后再提交`,
      details: validated
        .filter(r => r.errors.length > 0)
        .slice(0, 20)
        .map(r => ({ rowIndex: r.rowIndex, errors: r.errors })),
    }, { status: 400 });
  }

  try {
    // 事务：删除旧数据 + 写入新数据 + 状态流转（条件更新防重入）
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.import.updateMany({
        where: { id: importId, status: { in: ['parsed', 'pending', 'parsing'] } },
        data: { status: 'submitted' },
      });
      if (claimed.count === 0) {
        return { conflict: true };
      }

      await tx.order.deleteMany({ where: { importId } });
      await tx.order.createMany({
        data: validated.map(row => ({
          importId,
          externalCode: row.data.externalCode || null,
          receiverStore: row.data.receiverStore || null,
          receiverName: row.data.receiverName || null,
          receiverPhone: row.data.receiverPhone || null,
          receiverAddress: row.data.receiverAddress || null,
          skuCode: row.data.skuCode || '',
          skuName: row.data.skuName || '',
          skuQuantity: row.data.skuQuantity || '0',
          skuSpec: row.data.skuSpec || null,
          remark: row.data.remark || null,
          rowIndex: row.rowIndex,
          hasError: false,
          errorMsg: null,
        })),
      });
      await tx.import.update({
        where: { id: importId },
        data: {
          status: 'submitted',
          totalRows: validated.length,
          errorRows: 0,
        },
      });
      return { conflict: false, totalRows: validated.length };
    });

    if (result.conflict) {
      return NextResponse.json({ error: '导入状态不允许提交（可能已提交）' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      totalRows: result.totalRows,
      message: `成功提交 ${result.totalRows} 条运单`,
    });
  } catch (error: any) {
    console.error('提交事务异常:', error);
    return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
  }
}
