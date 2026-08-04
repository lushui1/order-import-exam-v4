import { NextRequest, NextResponse } from 'next/server';
import { callLLM, buildAnalyzePrompt } from '@/lib/llm';
import { getFilePreview } from '@/lib/rule-engine/engine';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }
    
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = getFilePreview(buffer, file.name);
    const prompt = buildAnalyzePrompt(preview, file.name);
    
    const result = await callLLM(prompt);
    
    // 提取JSON
    let ruleJson = result;
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      ruleJson = jsonMatch[1].trim();
    }
    
    // 验证JSON格式
    try {
      const parsed = JSON.parse(ruleJson);
      return NextResponse.json({ rule: parsed, raw: result });
    } catch {
      return NextResponse.json({ 
        error: 'AI返回的规则格式不正确，请重试',
        raw: result 
      }, { status: 422 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
