import { ParseRule, ParsedRow, ColumnMapping } from './types';

// Word解析器 - 服务端使用
export async function parseWord(buffer: Buffer, rule: ParseRule): Promise<ParsedRow[]> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  
  return parseWordText(text, rule);
}

function parseWordText(text: string, rule: ParseRule): ParsedRow[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const results: ParsedRow[] = [];
  
  // 提取收货信息
  const tailInfo: Record<string, string> = {};
  for (const line of lines) {
    const phoneMatch = line.match(/收货电话[：:]\s*(\d{11})/);
    if (phoneMatch) tailInfo.receiverPhone = phoneMatch[1];
    
    const nameMatch = line.match(/收货人[：:]\s*(\S+)/);
    if (nameMatch) tailInfo.receiverName = nameMatch[1];
    
    const addrMatch = line.match(/收货地址[：:]\s*(.+)/);
    if (addrMatch) tailInfo.receiverAddress = addrMatch[1].trim();
  }
  
  // 按分隔线分割记录
  const records: string[][] = [];
  let current: string[] = [];
  
  for (const line of lines) {
    if (/^[─━\-═]{5,}$/.test(line)) {
      if (current.length > 0) {
        records.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) records.push(current);
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const mapped: Record<string, string> = { ...tailInfo };
    
    for (const line of record) {
      // 格式1: 编号. 编码 | 名称 | 规格 | 数量
      const itemMatch = line.match(/(\d+)\.\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S*)\s*\|\s*(\d+)/);
      if (itemMatch) {
        mapped.skuCode = itemMatch[2];
        mapped.skuName = itemMatch[3];
        mapped.skuSpec = itemMatch[4] || '';
        mapped.skuQuantity = itemMatch[5];
        continue;
      }
      
      // 格式2: 编码 名称 规格 数量
      const simpleMatch = line.match(/^([A-Z]{2,}\d+)\s+(.+?)\s+(\d+\S*)\s+(\d+)$/);
      if (simpleMatch) {
        mapped.skuCode = simpleMatch[1];
        mapped.skuName = simpleMatch[2];
        mapped.skuSpec = simpleMatch[3];
        mapped.skuQuantity = simpleMatch[4];
        continue;
      }
      
      // 收货门店
      const storeMatch = line.match(/收货门店[：:]\s*(.+)/);
      if (storeMatch) mapped.receiverStore = storeMatch[1].trim();
      
      // 外部编码
      const codeMatch = line.match(/(?:配送单号|外部编码|单号)[：:]\s*(\S+)/);
      if (codeMatch) mapped.externalCode = codeMatch[1];
      
      // 备注
      const remarkMatch = line.match(/备注[：:]\s*(.+)/);
      if (remarkMatch) mapped.remark = remarkMatch[1].trim();
    }
    
    if (mapped.skuCode || mapped.skuName) {
      const errors = validateRow(mapped);
      results.push({
        rowIndex: i + 1,
        data: mapped,
        errors,
      });
    }
  }
  
  return results;
}

function validateRow(data: Record<string, string>): string[] {
  const errors: string[] = [];
  
  const hasA = !!(data.receiverStore);
  const hasB = !!(data.receiverName && data.receiverPhone && data.receiverAddress);
  if (!hasA && !hasB) {
    errors.push('收货信息缺失');
  }
  
  if (!data.skuCode) errors.push('SKU物品编码不能为空');
  if (!data.skuName) errors.push('SKU物品名称不能为空');
  if (!data.skuQuantity) errors.push('SKU发货数量不能为空');
  
  if (data.skuQuantity) {
    const qty = parseFloat(data.skuQuantity);
    if (isNaN(qty) || qty <= 0) {
      errors.push('SKU发货数量必须为正数');
    }
  }
  
  return errors;
}
