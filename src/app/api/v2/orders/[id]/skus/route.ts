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
 * GET /api/v2/orders/:id/skus?skuCode=xxx
 * 校验 SKU 是否属于该运单（raw SQL）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) return unauthorized();

  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const skuCode = searchParams.get('skuCode');

    if (!skuCode) {
      return NextResponse.json({ error: '缺少 skuCode 参数' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT sku_code, sku_name, sku_quantity, sku_spec
       FROM orders WHERE id = $1 AND sku_code = $2 LIMIT 1`,
      isNaN(Number(id)) ? id : Number(id), skuCode
    );

    if (rows.length === 0) {
      // 检查运单本身是否存在
      const orderExists = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
        'SELECT 1 FROM orders WHERE id = $1 LIMIT 1',
        isNaN(Number(id)) ? id : Number(id)
      );
      if (orderExists.length === 0) {
        return NextResponse.json({ error: '运单不存在' }, { status: 404 });
      }
      return NextResponse.json({ exists: false, skuInfo: null });
    }

    const o = rows[0];
    return NextResponse.json({
      exists: true,
      skuInfo: {
        skuCode: o.sku_code,
        skuName: o.sku_name,
        quantity: String(o.sku_quantity || ''),
        spec: o.sku_spec,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
