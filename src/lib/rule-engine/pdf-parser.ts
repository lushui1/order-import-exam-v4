import { ParseRule, ParsedRow, ColumnMapping } from './types';

// PDF解析器 - 服务端使用
export async function parsePDF(buffer: Buffer, rule: ParseRule): Promise<ParsedRow[]> {
  // @ts-ignore - pdf-parse types are incomplete
  const pdfParse = (await import('pdf-parse')).default || (await import('pdf-parse'));
  const pdfData = await pdfParse(buffer);
  const text: string = pdfData.text;
  
  switch (rule.strategy) {
    case 'text_parse':
      return parseTextPDF(text, rule);
    default:
      return parseTablePDF(text, rule);
  }
}

// 表格式PDF解析
function parseTablePDF(text: string, rule: ParseRule): ParsedRow[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const results: ParsedRow[] = [];
  
  // 找表头
  let headerIdx = -1;
  const headerKeywords = ['物品编码', '物品名称', 'SKU', '编码', '名称', '数量'];
  
  for (let i = 0; i < lines.length; i++) {
    const matches = headerKeywords.filter(k => lines[i].includes(k));
    if (matches.length >= 2) {
      headerIdx = i;
      break;
    }
  }
  
  if (headerIdx < 0) return [];
  
  // 提取收货信息
  const tailInfo = extractTailInfo(lines, rule);
  
  // 解析数据行
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('合计') || line.includes('总计')) continue;
    if (line.includes('签字') || line.includes('签收')) continue;
    if (!line || /^[─━\-]+$/.test(line)) continue;
    
    const dataMatch = line.match(/^\d+\s+(.+)/);
    if (!dataMatch) continue;
    
    // 按空格分割（PDF文本通常空格分隔）
    const parts = line.split(/\s{2,}/);
    const mapped: Record<string, string> = { ...tailInfo };
    
    if (rule.mappings && rule.mappings.length > 0) {
      for (const m of rule.mappings) {
        const idx = parseInt(m.source) - 1;
        if (idx >= 0 && idx < parts.length) {
          mapped[m.target] = parts[idx].trim();
        }
      }
    } else {
      // 自动映射
      if (parts.length >= 4) {
        mapped.skuCode = parts[1] || '';
        mapped.skuName = parts[2] || '';
        mapped.skuSpec = parts[3] || '';
        mapped.skuQuantity = parts[parts.length - 2] || '';
      }
    }
    
    const errors = validateRow(mapped);
    results.push({ rowIndex: i + 1, data: mapped, errors });
  }
  
  return results;
}

// 纯文本PDF解析
function parseTextPDF(text: string, rule: ParseRule): ParsedRow[] {
  const results: ParsedRow[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const tailInfo = extractTailInfo(lines, rule);
  
  const records: string[][] = [];
  let current: string[] = [];
  
  for (const line of lines) {
    if (/^[─━\-]{5,}$/.test(line)) {
      if (current.length > 0) { records.push(current); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) records.push(current);
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const mapped: Record<string, string> = { ...tailInfo };
    
    for (const line of record) {
      const itemMatch = line.match(/(\d+)\.\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S*)\s*\|\s*(\d+)/);
      if (itemMatch) {
        mapped.skuCode = itemMatch[2];
        mapped.skuName = itemMatch[3];
        mapped.skuSpec = itemMatch[4] || '';
        mapped.skuQuantity = itemMatch[5];
      }
    }
    
    if (mapped.skuCode || mapped.skuName) {
      const errors = validateRow(mapped);
      results.push({ rowIndex: i + 1, data: mapped, errors });
    }
  }
  
  return results;
}

function extractTailInfo(lines: string[], rule: ParseRule): Record<string, string> {
  const info: Record<string, string> = {};
  
  if (rule.pdfTailPatterns) {
    for (const line of lines) {
      for (const p of rule.pdfTailPatterns) {
        const m = line.match(new RegExp(p.regex));
        if (m) info[p.target] = (m[1] || '').trim();
      }
    }
  }
  
  for (const line of lines) {
    const phoneMatch = line.match(/收货电话[：:]\s*(\d{11})/);
    if (phoneMatch) info.receiverPhone = phoneMatch[1];
    const nameMatch = line.match(/收货人[：:]\s*(\S+)/);
    if (nameMatch) info.receiverName = nameMatch[1];
    const addrMatch = line.match(/收货地址[：:]\s*(.+)/);
    if (addrMatch) info.receiverAddress = addrMatch[1].trim();
  }
  
  return info;
}

function validateRow(data: Record<string, string>): string[] {
  const errors: string[] = [];
  const hasA = !!(data.receiverStore);
  const hasB = !!(data.receiverName && data.receiverPhone && data.receiverAddress);
  if (!hasA && !hasB) errors.push('收货信息缺失');
  if (!data.skuCode) errors.push('SKU物品编码不能为空');
  if (!data.skuName) errors.push('SKU物品名称不能为空');
  if (!data.skuQuantity) errors.push('SKU发货数量不能为空');
  if (data.skuQuantity) {
    const qty = parseFloat(data.skuQuantity);
    if (isNaN(qty) || qty <= 0) errors.push('SKU发货数量必须为正数');
  }
  return errors;
}
