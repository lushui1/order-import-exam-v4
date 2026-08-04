import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { importId } = body;
    
    if (!importId) {
      return NextResponse.json({ error: '缺少导入ID' }, { status: 400 });
    }
    
    // 检查是否有错误行
    const errorCount = await prisma.order.count({
      where: { importId, hasError: true },
    });
    
    if (errorCount > 0) {
      return NextResponse.json({ 
        error: `还有 ${errorCount} 条错误数据，请先修正后再提交` 
      }, { status: 400 });
    }
    
    // 更新状态
    await prisma.import.update({
      where: { id: importId },
      data: { status: 'submitted' },
    });
    
    const totalRows = await prisma.order.count({ where: { importId } });
    
    return NextResponse.json({
      success: true,
      totalRows,
      message: `成功提交 ${totalRows} 条运单`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
