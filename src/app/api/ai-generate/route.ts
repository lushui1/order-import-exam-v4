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
      const errors = validateRuleShape(parsed);
      if (errors.length > 0) {
        return NextResponse.json({
          error: `AI返回的规则结构不完整：${errors.join('；')}`,
          raw: result,
        }, { status: 422 });
      }
      return NextResponse.json({ rule: parsed, raw: result });
    } catch {
      return NextResponse.json({ 
        error: 'AI返回的规则格式不正确，请重试',
        raw: result 
      }, { status: 422 });
    }
  } catch (error: any) {
    console.error('AI生成规则异常:', error);
    return NextResponse.json({ error: 'AI分析失败，请稍后重试' }, { status: 500 });
  }
}

// 轻量结构校验：确认 AI 输出是可用规则而非任意 JSON
function validateRuleShape(rule: any): string[] {
  const errors: string[] = [];
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    return ['输出不是规则对象'];
  }
  if (typeof rule.name !== 'string' || !rule.name.trim()) errors.push('缺少 name');
  if (typeof rule.fileType !== 'string' || !['excel', 'word', 'pdf'].includes(rule.fileType)) {
    errors.push('fileType 必须是 excel/word/pdf');
  }
  if (!Array.isArray(rule.mappings)) {
    errors.push('缺少 mappings 数组');
  } else {
    const validTargets = new Set([
      'externalCode', 'receiverStore', 'receiverName', 'receiverPhone',
      'receiverAddress', 'skuCode', 'skuName', 'skuQuantity', 'skuSpec', 'remark',
    ]);
    for (const m of rule.mappings) {
      if (typeof m?.source !== 'string' || typeof m?.target !== 'string') {
        errors.push('mappings 项缺少 source/target');
        break;
      }
      if (!validTargets.has(m.target)) {
        errors.push(`mappings 含非法目标字段: ${m.target}`);
        break;
      }
    }
  }
  return errors;
}
