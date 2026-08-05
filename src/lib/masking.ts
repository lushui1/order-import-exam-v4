// 敏感字段脱敏（PRD 模块六：raw_value 敏感字段需脱敏 / 考点4 敏感数据处理）
// 手机号、姓名、地址在错误明细中展示时必须脱敏

// 手机号：13812345678 → 138****5678
export function maskPhone(phone: string): string {
  const p = phone.replace(/\s/g, '');
  if (/^1[3-9]\d{9}$/.test(p)) {
    return `${p.slice(0, 3)}****${p.slice(7)}`;
  }
  return p.length > 4 ? `${p.slice(0, 2)}***${p.slice(-2)}` : '***';
}

// 姓名：张三 → 张*；欧阳娜娜 → 欧阳**
export function maskName(name: string): string {
  if (!name) return '';
  if (name.length <= 1) return '*';
  if (name.length === 2) return `${name[0]}*`;
  return `${name.slice(0, 2)}${'*'.repeat(name.length - 2)}`;
}

// 地址：保留前 6 个字，其余打码
export function maskAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 6) return `${address.slice(0, 2)}***`;
  return `${address.slice(0, 6)}${'*'.repeat(Math.min(address.length - 6, 8))}`;
}

// 需要脱敏的字段
const SENSITIVE_FIELDS = new Set(['receiverPhone', 'receiverName', 'receiverAddress']);

// 判断字段是否需要脱敏
export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELDS.has(fieldName);
}

// 按字段名脱敏
export function maskValue(fieldName: string, value: string): string {
  if (!isSensitiveField(fieldName)) return value;
  switch (fieldName) {
    case 'receiverPhone': return maskPhone(value);
    case 'receiverName': return maskName(value);
    case 'receiverAddress': return maskAddress(value);
    default: return value;
  }
}
