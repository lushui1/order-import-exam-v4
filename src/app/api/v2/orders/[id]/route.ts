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
 * GET /api/v2/orders/:id — 运单详情（raw SQL 适配实际表结构）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) return unauthorized();

  try {
    const { id } = await params;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT id, external_code, receive_store, receiver_name, receiver_phone,
              receiver_address, sku_code, sku_name, sku_quantity, sku_spec, remark, created_at
       FROM orders WHERE id = $1 LIMIT 1`,
      isNaN(Number(id)) ? id : Number(id)
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: '运单不存在' }, { status: 404 });
    }

    const o = rows[0];
    return NextResponse.json({
      id: String(o.id),
      externalCode: o.external_code,
      receiverStore: o.receive_store,
      receiverName: o.receiver_name,
      receiverPhone: o.receiver_phone,
      receiverAddress: o.receiver_address,
      totalAmount: 0,
      skuCode: o.sku_code,
      skuName: o.sku_name,
      skuQuantity: String(o.sku_quantity || ''),
      skuSpec: o.sku_spec,
      remark: o.remark,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
