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
    const filePath = path.join(uploadDir, `${importId}_${importRecord.fileName}`);
    
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      return NextResponse.json({ error: '文件不存在，请重新上传' }, { status: 404 });
    }
    
    // 更新状态为解析中（仅当尚未解析完成，避免并发重复解析互相覆盖）
    const claimed = await prisma.import.updateMany({
      where: { id: importId, status: { in: ['pending', 'parsing', 'parsed'] } },
      data: { status: 'parsing' },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: '导入状态不允许解析' }, { status: 409 });
    }
    
    // 执行解析
    const parseRule = rule as ParseRule;
    const rows = await executeParse(buffer, importRecord.fileName, parseRule);
    
    // 保存规则（不参与导入事务，失败不影响数据落库）
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
    
    const errorRows = rows.filter(r => r.errors.length > 0).length;
    
    // 删除旧结果 + 批量写入 + 更新状态，放在同一事务内保证原子性
    await prisma.$transaction([
      prisma.order.deleteMany({ where: { importId } }),
      prisma.order.createMany({
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
      }),
      prisma.import.update({
        where: { id: importId },
        data: {
          status: 'parsed',
          totalRows: rows.length,
          errorRows,
          ruleId: ruleId || null,
        },
      }),
    ]);
    
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
    console.error('解析接口异常:', error);
    return NextResponse.json({ error: '解析失败，请稍后重试' }, { status: 500 });
  }
}
