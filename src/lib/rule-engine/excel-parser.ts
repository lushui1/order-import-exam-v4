import * as XLSX from 'xlsx';
import { ParseRule, ColumnMapping, ParsedRow, FIELD_KEYS } from './types';

// Excel解析器
export function parseExcel(buffer: Buffer, rule: ParseRule): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true, cellNF: true });
  const results: ParsedRow[] = [];
  
  // 确定要解析的sheets
  const sheets = getSheets(wb, rule);
  
  for (const sheetName of sheets) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    
    const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
    if (data.length === 0) continue;
    
    let rows: ParsedRow[];
    
    switch (rule.strategy) {
      case 'card_based':
        rows = parseCardBased(data, rule);
        break;
      case 'standard':
      default:
        rows = parseStandard(data, rule);
        break;
    }
    
    // 应用尾部信息提取
    if (rule.tailSections && rule.tailSections.length > 0) {
      applyTailSections(data, rows, rule);
    }
    
    // 应用分组聚合
    if (rule.groupBy) {
      rows = applyGroupAggregation(rows, rule);
    }
    
    results.push(...rows);
  }
  
  return results;
}

// 获取要解析的sheets
function getSheets(wb: XLSX.WorkBook, rule: ParseRule): string[] {
  if (rule.sheetSelection === 'all') {
    return wb.SheetNames;
  }
  if (typeof rule.sheetSelection === 'number') {
    return rule.sheetSelection < wb.SheetNames.length 
      ? [wb.SheetNames[rule.sheetSelection]] 
      : [];
  }
  return [wb.SheetNames[0]];
}

// 标准表格解析
function parseStandard(data: any[][], rule: ParseRule): ParsedRow[] {
  let headerRow = (rule.headerRow || 1) - 1;
  let dataStart = (rule.dataStartRow || (headerRow + 2)) - 1;
  const dataEnd = rule.dataEndRow ? rule.dataEndRow - 1 : data.length;
  const skipRows = new Set((rule.skipRows || []).map(r => r - 1));
  
  // 如果没有指定表头行，尝试自动检测
  if (!rule.headerRow) {
    const detected = detectHeaderRow(data);
    if (detected >= 0) {
      headerRow = detected;
      dataStart = detected + 1;
    }
  }
  
  // 获取表头
  const headers = (data[headerRow] || []).map((h: any) => String(h || '').trim());
  
  const results: ParsedRow[] = [];
  
  for (let i = dataStart; i < Math.min(dataEnd, data.length); i++) {
    if (skipRows.has(i)) continue;
    
    const row = data[i] || [];
    // 跳过空行
    if (row.every((c: any) => !c && c !== 0)) continue;
    // 跳过合计行
    const firstCell = String(row[0] || '').trim();
    if (firstCell.includes('合计') || firstCell.includes('总计')) continue;
    // 跳过表头重复行
    if (isHeaderRow(row, headers)) continue;
    
    const mapped = applyMappings(row, headers, rule.mappings);
    const errors = validateRow(mapped);
    
    results.push({
      rowIndex: i + 1,
      data: mapped,
      errors,
    });
  }
  
  return results;
}

// 自动检测表头行
function detectHeaderRow(data: any[][]): number {
  const headerKeywords = ['编码', '名称', '数量', '规格', '备注', '电话', '地址', '门店', 'SKU', '商品'];
  
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i] || [];
    const rowStr = row.map((c: any) => String(c || '')).join(' ');
    
    let matchCount = 0;
    for (const kw of headerKeywords) {
      if (rowStr.includes(kw)) matchCount++;
    }
    
    if (matchCount >= 3) return i;
  }
  
  return 0; // 默认第一行
}

// 检查是否是表头重复行
function isHeaderRow(row: any[], headers: string[]): boolean {
  const rowStr = row.map((c: any) => String(c || '').trim()).join('|');
  const headerStr = headers.join('|');
  return rowStr === headerStr;
}

// 卡片式解析
function parseCardBased(data: any[][], rule: ParseRule): ParsedRow[] {
  if (!rule.cardConfig) return [];
  
  const boundaryRe = new RegExp(rule.cardConfig.boundaryPattern);
  const headerOffset = rule.cardConfig.headerRowOffset || 1;
  const dataOffset = rule.cardConfig.dataRowOffset || 2;
  
  const results: ParsedRow[] = [];
  let cardStart = -1;
  let headers: string[] = [];
  let cardReceiver: Record<string, string> = {};
  
  for (let i = 0; i < data.length; i++) {
    const firstCell = String((data[i] || [])[0] || '').trim();
    
    if (boundaryRe.test(firstCell)) {
      // 处理上一个卡片
      if (cardStart >= 0) {
        // 已在循环中处理
      }
      cardStart = i;
      headers = [];
      cardReceiver = {};
      
      // 读取表头
      const headerIdx = i + headerOffset;
      if (headerIdx < data.length) {
        headers = (data[headerIdx] || []).map((h: any) => String(h || '').trim());
      }
      
      // 提取收货信息（表头行之前的数据行）
      if (rule.cardConfig.tailPatterns) {
        for (let j = i + 1; j < headerIdx; j++) {
          const row = data[j] || [];
          const rowStr = row.map((c: any) => String(c || '')).join(' ');
          for (const p of rule.cardConfig.tailPatterns) {
            const m = rowStr.match(new RegExp(p.regex));
            if (m) cardReceiver[p.target] = m[1] || '';
          }
        }
      }
      continue;
    }
    
    // 在卡片内解析数据行
    if (cardStart >= 0 && headers.length > 0 && i >= cardStart + dataOffset) {
      // 空行表示卡片结束
      if (data[i]?.every((c: any) => !c && c !== 0)) {
        cardStart = -1;
        continue;
      }
      
      const row = data[i] || [];
      const mapped = applyMappings(row, headers, rule.mappings);
      // 合并卡片级收货信息
      Object.assign(mapped, cardReceiver);
      
      const errors = validateRow(mapped);
      results.push({ rowIndex: i + 1, data: mapped, errors });
    }
  }
  
  return results;
}

// 应用列映射
function applyMappings(row: any[], headers: string[], mappings: ColumnMapping[]): Record<string, string> {
  const result: Record<string, string> = {};
  
  for (const m of mappings) {
    let value = '';
    
    // 按列号（A, B, C...）或列名匹配
    const colIdx = colToIndex(m.source);
    if (colIdx >= 0 && colIdx < row.length) {
      value = String(row[colIdx] ?? '').trim();
    } else {
      // 按表头名匹配（模糊匹配）
      const idx = headers.findIndex(h => {
        const hLower = h.toLowerCase();
        const sLower = m.source.toLowerCase();
        return h === m.source || 
               h.includes(m.source) || 
               m.source.includes(h) ||
               hLower.includes(sLower) ||
               sLower.includes(hLower);
      });
      if (idx >= 0 && idx < row.length) {
        value = String(row[idx] ?? '').trim();
      }
    }
    
    // 如果映射失败，尝试智能匹配
    if (!value && m.target) {
      value = smartMatch(row, headers, m.target);
    }
    
    // 转换
    if (m.transform === 'int') {
      value = value ? String(parseInt(value, 10) || 0) : '';
    } else if (m.transform === 'float') {
      value = value ? String(parseFloat(value) || 0) : '';
    } else if (m.transform === 'trim') {
      value = value.trim();
    }
    
    // 默认值
    if (!value && m.defaultValue) {
      value = m.defaultValue;
    }
    
    result[m.target] = value;
  }
  
  return result;
}

// 智能匹配列
function smartMatch(row: any[], headers: string[], target: string): string {
  const targetLower = target.toLowerCase();
  
  // 定义关键词映射
  const keywords: Record<string, string[]> = {
    'externalCode': ['外部编码', '外部单号', '单号', '订单号', '编号', 'code', 'order'],
    'receiverStore': ['门店', '店铺', '收货门店', '收货店铺', 'store', 'shop'],
    'receiverName': ['收货人', '收件人', '姓名', '联系人', 'name', 'receiver'],
    'receiverPhone': ['电话', '手机', '联系电话', '收货电话', 'phone', 'tel'],
    'receiverAddress': ['地址', '收货地址', '收件地址', 'address', 'addr'],
    'skuCode': ['编码', '商品编码', 'SKU', '货号', '物料编码', 'code', 'sku'],
    'skuName': ['名称', '商品名称', '品名', '物品名称', 'name', 'product'],
    'skuQuantity': ['数量', '发货数量', '出库数量', 'qty', 'quantity', 'count'],
    'skuSpec': ['规格', '规格型号', '型号', 'spec', 'model'],
    'remark': ['备注', '说明', 'remark', 'note', 'memo'],
  };

  const targetKeywords = keywords[target] || [];
  
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    for (const kw of targetKeywords) {
      if (h.includes(kw.toLowerCase())) {
        return String(row[i] ?? '').trim();
      }
    }
  }
  
  return '';
}

// 提取尾部信息
function applyTailSections(data: any[][], rows: ParsedRow[], rule: ParseRule) {
  if (!rule.tailSections) return;
  
  for (const section of rule.tailSections) {
    const tailData: Record<string, string> = {};
    
    for (let i = section.rowStart - 1; i < Math.min(section.rowEnd, data.length); i++) {
      const row = data[i] || [];
      const rowStr = row.map((c: any) => String(c || '')).join(' ');
      
      for (const p of section.patterns) {
        const m = rowStr.match(new RegExp(p.regex));
        if (m) tailData[p.target] = (m[1] || '').trim();
      }
    }
    
    // 将尾部信息应用到所有行
    if (Object.keys(tailData).length > 0) {
      for (const row of rows) {
        for (const [k, v] of Object.entries(tailData)) {
          if (!row.data[k]) row.data[k] = v;
        }
      }
    }
  }
}

// 分组聚合
function applyGroupAggregation(rows: ParsedRow[], rule: ParseRule): ParsedRow[] {
  if (!rule.groupBy) return rows;
  
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const key = row.data[rule.groupBy] || '__ungrouped__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  
  const results: ParsedRow[] = [];
  for (const [, groupRows] of groups) {
    // 从第一行获取共享字段
    const shared: Record<string, string> = {};
    if (rule.shareFields) {
      for (const f of rule.shareFields) {
        shared[f] = groupRows[0].data[f] || '';
      }
    }
    
    for (const row of groupRows) {
      // 应用共享字段
      for (const [k, v] of Object.entries(shared)) {
        if (!row.data[k]) row.data[k] = v;
      }
      results.push(row);
    }
  }
  
  return results;
}

// 列号转换 (A→0, B→1, ...)
function colToIndex(col: string): number {
  const upper = col.toUpperCase();
  if (/^[A-Z]+$/.test(upper)) {
    let idx = 0;
    for (let i = 0; i < upper.length; i++) {
      idx = idx * 26 + (upper.charCodeAt(i) - 64);
    }
    return idx - 1;
  }
  const n = parseInt(col, 10);
  return isNaN(n) ? -1 : n - 1;
}

// 校验行
function validateRow(data: Record<string, string>): string[] {
  const errors: string[] = [];
  
  // A组/B组二选一
  const hasA = !!(data.receiverStore);
  const hasB = !!(data.receiverName && data.receiverPhone && data.receiverAddress);
  if (!hasA && !hasB) {
    errors.push('收货信息缺失：需填写收货门店(A组)或收件人姓名+电话+地址(B组)');
  }
  
  // 必填校验
  if (!data.skuCode) errors.push('SKU物品编码不能为空');
  if (!data.skuName) errors.push('SKU物品名称不能为空');
  if (!data.skuQuantity) errors.push('SKU发货数量不能为空');
  
  // 数量校验
  if (data.skuQuantity) {
    const qty = parseFloat(data.skuQuantity);
    if (isNaN(qty) || qty <= 0) {
      errors.push('SKU发货数量必须为正数');
    }
  }
  
  // 电话格式
  if (data.receiverPhone) {
    const phone = data.receiverPhone.replace(/\s/g, '');
    if (!/^1[3-9]\d{9}$/.test(phone) && !/^0\d{2,3}-?\d{7,8}$/.test(phone)) {
      errors.push('收件人电话格式不正确');
    }
  }
  
  return errors;
}
