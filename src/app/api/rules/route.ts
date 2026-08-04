import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// 获取所有规则
export async function GET() {
  try {
    const rules = await prisma.parseRule.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(rules);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 创建/更新规则
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, description, fileType, ruleJson } = body;
    
    if (!name || !ruleJson) {
      return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
    }
    
    const ruleStr = typeof ruleJson === 'string' ? ruleJson : JSON.stringify(ruleJson);
    
    if (id) {
      const rule = await prisma.parseRule.update({
        where: { id },
        data: { name, description, fileType, ruleJson: ruleStr },
      });
      return NextResponse.json(rule);
    } else {
      const rule = await prisma.parseRule.create({
        data: { name, description, fileType, ruleJson: ruleStr },
      });
      return NextResponse.json(rule);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 删除规则
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: '缺少规则ID' }, { status: 400 });
    }
    
    await prisma.parseRule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
