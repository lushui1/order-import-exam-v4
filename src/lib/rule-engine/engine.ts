import { ParseRule, ParsedRow } from './types';
import { parseExcel } from './excel-parser';
import { parsePDF } from './pdf-parser';
import { parseWord } from './word-parser';

export type { ParseRule, ParsedRow } from './types';
export { ORDER_FIELDS, FIELD_KEYS } from './types';

// 主解析入口
export async function executeParse(
  buffer: Buffer,
  fileName: string,
  rule: ParseRule
): Promise<ParsedRow[]> {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  
  switch (ext) {
    case 'xlsx':
    case 'xls':
      return parseExcel(buffer, rule);
    case 'pdf':
      return parsePDF(buffer, rule);
    case 'docx':
      return parseWord(buffer, rule);
    default:
      throw new Error(`不支持的文件格式: .${ext}`);
  }
}

// 获取文件预览内容（用于AI分析）
export function getFilePreview(buffer: Buffer, fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const lines: string[] = [];
    
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
      lines.push(`=== Sheet: ${sheetName} (${data.length}行) ===`);
      
      // 前15行
      for (let i = 0; i < Math.min(15, data.length); i++) {
        const row = data[i] || [];
        const vals = row.slice(0, 15).map((c: any) => String(c ?? '').substring(0, 40));
        lines.push(`Row ${i + 1}: ${vals.join(' | ')}`);
      }
      
      if (data.length > 15) {
        lines.push(`... (共${data.length}行)`);
        // 最后3行
        for (let i = Math.max(15, data.length - 3); i < data.length; i++) {
          const row = data[i] || [];
          const vals = row.slice(0, 15).map((c: any) => String(c ?? '').substring(0, 40));
          lines.push(`Row ${i + 1}: ${vals.join(' | ')}`);
        }
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  // PDF/Word 返回原始文本预览
  return buffer.toString('utf-8').substring(0, 3000);
}
