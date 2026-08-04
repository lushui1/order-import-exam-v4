import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { executeParse } from '@/lib/rule-engine/engine';
import { ParseRule } from '@/lib/rule-engine/types';
import { readFile } from 'fs/promises';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { importId, rule } = body;
    
    if (!importId || !rule) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }
    
    // 获取导入记录
    const importRecord = await prisma.import.findUnique({
      where: { id: importId },
    });
    
    if (!importRecord) {
      return NextResponse.json({ error: '导入记录不存在' }, { status: 404 });
    }
    
    // 读取文件
    const uploadDir = path.join(process.cwd(), 'uploads');
    const files = await readFile(uploadDir).catch(() => []);
    const filePath = path.join(uploadDir, `${importId}_${importRecord.fileName}`);
    
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      return NextResponse.json({ error: '文件不存在，请重新上传' }, { status: 404 });
    }
    
    // 检查是否已有解析结果
    const existingOrders = await prisma.order.count({
      where: { importId },
    });
    
    if (existingOrders > 0) {
      // 删除旧记录重新解析
      await prisma.order.deleteMany({ where: { importId } });
    }
    
    // 更新状态
    await prisma.import.update({
      where: { id: importId },
      data: { status: 'parsing' },
    });
    
    // 执行解析
    const parseRule = rule as ParseRule;
    const rows = await executeParse(buffer, importRecord.fileName, parseRule);
    
    // 保存规则
    let ruleId = body.ruleId;
    if (!ruleId && rule.name) {
      const savedRule = await prisma.parseRule.create({
        data: {
          name: rule.name,
          description: rule.description || '',
          fileType: rule.fileType || 'excel',
          ruleJson: JSON.stringify(rule),
        },
      });
      ruleId = savedRule.id;
    }
    
    // 保存解析结果
    const errorRows = rows.filter(r => r.errors.length > 0).length;
    
    // 批量创建订单
    await prisma.order.createMany({
      data: rows.map(row => ({
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
        hasError: row.errors.length > 0,
        errorMsg: row.errors.length > 0 ? row.errors.join('; ') : null,
      })),
    });
    
    // 更新导入记录
    await prisma.import.update({
      where: { id: importId },
      data: {
        status: 'parsed',
        totalRows: rows.length,
        errorRows,
        ruleId: ruleId || null,
      },
    });
    
    return NextResponse.json({
      totalRows: rows.length,
      errorRows,
      rows: rows.map(r => ({
        rowIndex: r.rowIndex,
        data: r.data,
        errors: r.errors,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
