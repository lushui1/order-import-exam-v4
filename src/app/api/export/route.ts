import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// 服务端导出：避免在客户端打包 xlsx（体积大），且数据来源统一为服务端
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rows } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: '没有可导出的数据' }, { status: 400 });
    }

    const data = rows.map((r: any) => r?.data ?? r ?? {});
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '运单数据');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="orders_${date}.xlsx"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error: any) {
    console.error('导出接口异常:', error);
    return NextResponse.json({ error: '导出失败，请稍后重试' }, { status: 500 });
  }
}
