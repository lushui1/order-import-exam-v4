import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// ── 简单 API Key 鉴权 ──
const API_KEY = process.env.V2_API_KEY || 'dev-key';

function checkAuth(req: NextRequest): boolean {
  const key = req.headers.get('x-api-key');
  return key === API_KEY;
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * GET /api/v2/orders?page=1&pageSize=50
 * GET /api/v2/orders?externalCode=XXX&skuCode=YYY  (精确匹配查询)
 * 按条件查询运单列表（分页）— 使用 raw SQL 适配实际表结构
 */
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const externalCode = searchParams.get('externalCode');
    const skuCode = searchParams.get('skuCode');

    // 如果传了 externalCode + skuCode，做精确匹配查询
    if (externalCode && skuCode) {
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
        `SELECT id, external_code, receive_store, receiver_name, receiver_phone,
                receiver_address, sku_code, sku_name, sku_quantity, sku_spec, remark, created_at
         FROM orders WHERE external_code = $1 AND sku_code = $2 LIMIT 1`,
        externalCode, skuCode
      );
      return NextResponse.json({
        found: rows.length > 0,
        order: rows.length > 0 ? {
          id: String(rows[0].id),
          externalCode: rows[0].external_code,
          skuCode: rows[0].sku_code,
          skuName: rows[0].sku_name,
          skuQuantity: String(rows[0].sku_quantity || ''),
        } : null,
      });
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const offset = (page - 1) * pageSize;

    // 使用 raw SQL 适配实际 orders 表的列名
    const orders = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      `SELECT id, external_code, receive_store, receiver_name, receiver_phone,
              receiver_address, sku_code, sku_name, sku_quantity, sku_spec, remark, created_at
       FROM orders ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      pageSize, offset
    );
    const totalResult = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
      'SELECT COUNT(*) as cnt FROM orders'
    );
    const total = Number(totalResult[0]?.cnt || 0);

    return NextResponse.json({
      orders: orders.map((o: any) => ({
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
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || '未知错误',
      hint: 'V2 数据库查询失败',
      shouldDegrade: true,
    }, { status: 503 });
  }
}
