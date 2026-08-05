import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // 分页参数校验：非法值回退默认，并限制范围
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawPageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, 100)
      : 20;
    const importId = searchParams.get('importId');
    const externalCode = searchParams.get('externalCode');
    const receiverName = searchParams.get('receiverName');
    
    // 查询导入历史
    if (searchParams.get('type') === 'history') {
      const imports = await prisma.import.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { _count: { select: { orders: true } } },
      });
      return NextResponse.json(imports);
    }
    
    // 查询运单
    const where: any = {};
    if (importId) where.importId = importId;
    if (externalCode) where.externalCode = { contains: externalCode };
    if (receiverName) where.receiverName = { contains: receiverName };
    
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);
    
    return NextResponse.json({
      orders,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
