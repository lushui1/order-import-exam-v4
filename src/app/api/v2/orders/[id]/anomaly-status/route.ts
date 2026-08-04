import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const API_KEY = process.env.V2_API_KEY || 'dev-key';

function checkAuth(req: NextRequest): boolean {
  return req.headers.get('x-api-key') === API_KEY;
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * POST /api/v2/orders/:id/anomaly-status
 * （可选）V3 回写异常状态标记
 * Order 表无状态字段，当前仅返回成功（记录日志用）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) return unauthorized();

  try {
    const { id } = await params;
    const body = await req.json();
    const { status, ticketNo, anomalyType } = body;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: '运单不存在' }, { status: 404 });
    }

    // Order 表暂无状态字段，暂做日志记录
    console.log(`[V2] 异常状态回写: order=${id}, status=${status}, ticketNo=${ticketNo}, anomalyType=${anomalyType}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
