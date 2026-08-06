import { NextRequest, NextResponse } from 'next/server';
import { callLLM, buildAnalyzePrompt } from '@/lib/llm';
import { getFilePreview } from '@/lib/rule-engine/engine';

// Vercel Serverless 函数最大执行时长（Hobby 上限 60s；LLM 推理较慢需要放宽）
export const maxDuration = 60;

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
    // 区分"未配置 LLM"与真正的失败：未配置时给用户明确提示（AI 是可选功能，不应报笼统错误）
    if (error?.message?.includes('LLM_API_KEY 未配置')) {
      return NextResponse.json({
        error: 'AI 功能未启用：未配置 LLM_API_KEY。可先在解析规则中选择已有规则或手动配置，AI 生成仅为可选功能。',
        code: 'LLM_NOT_CONFIGURED',
      }, { status: 503 });
    }
    console.error('AI生成规则异常:', error);
    // 区分"未配置 LLM"与真正的失败：未配置时给用户明确提示（AI 是可选功能，不应报笼统错误）
    if (error?.message?.includes('LLM_API_KEY 未配置')) {
      return NextResponse.json({
        error: 'AI 功能未启用：未配置 LLM_API_KEY。可先在解析规则中选择已有规则或手动配置，AI 生成仅为可选功能。',
        code: 'LLM_NOT_CONFIGURED',
      }, { status: 503 });
    }
    if (error?.message?.includes('超时')) {
      return NextResponse.json({
        error: 'AI 分析超时：文件过大或模型响应较慢，请稍后重试或换用已有解析规则。',
        code: 'LLM_TIMEOUT',
      }, { status: 504 });
    }
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
