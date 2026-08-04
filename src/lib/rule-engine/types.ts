// 解析规则类型定义

export type FileType = 'excel' | 'word' | 'pdf';

export type ParseStrategy = 'standard' | 'card_based' | 'multi_sheet' | 'text_parse';

// 列映射
export interface ColumnMapping {
  source: string;        // 源列名或列号 (A, B, C... 或 列名)
  target: string;        // 目标字段名
  required?: boolean;
  defaultValue?: string;
  transform?: 'trim' | 'int' | 'float' | 'string';
}

// 尾部信息提取（收货人信息在数据区之外）
export interface TailSection {
  rowStart: number;      // 起始行 (1-indexed)
  rowEnd: number;        // 结束行
  patterns: {            // 正则提取
    regex: string;
    target: string;      // 目标字段名
  }[];
}

// 卡片式配置
export interface CardConfig {
  boundaryPattern: string;  // 卡片边界正则 (如 "▶ 调拨记录 #\\d+")
  headerRowOffset: number;  // 卡片内表头相对边界的偏移
  dataRowOffset: number;    // 数据起始相对偏移
  tailPatterns?: {          // 卡片内收货信息提取
    regex: string;
    target: string;
  }[];
}

// 矩阵转置配置
export interface MatrixConfig {
  columnHeaderRow: number;  // 列头行（门店名所在行）
  rowFieldColumn: number;   // 行字段列（物品名所在列）
  dataStartRow: number;     // 数据起始行
  dataEndRow?: number;      // 数据结束行
  quantityParsePattern?: string; // 单元格值解析正则
}

// 完整解析规则
export interface ParseRule {
  name: string;
  description?: string;
  fileType: FileType;
  strategy: ParseStrategy;
  
  // Excel配置
  sheetSelection?: 'all' | number; // sheet索引，'all'表示遍历所有
  headerRow?: number;       // 表头行号 (1-indexed)
  dataStartRow?: number;    // 数据起始行
  dataEndRow?: number;      // 数据结束行 (0=自动检测)
  skipRows?: number[];      // 跳过的行号
  
  // 列映射
  mappings: ColumnMapping[];
  
  // 高级功能
  tailSections?: TailSection[];
  cardConfig?: CardConfig;
  matrixConfig?: MatrixConfig;
  
  // 聚合配置
  groupBy?: string;         // 按此字段分组
  shareFields?: string[];   // 分组内共享的字段
  
  // PDF配置
  pdfPageRange?: [number, number];
  pdfTableIndex?: number;
  pdfTailPatterns?: { regex: string; target: string }[];
}

// 校验后的数据行
export interface ParsedRow {
  rowIndex: number;
  data: Record<string, string>;
  errors: string[];
}

// 字段定义
export const ORDER_FIELDS = [
  { key: 'externalCode', label: '外部编码', required: false },
  { key: 'receiverStore', label: '收货门店', required: false, group: 'A' },
  { key: 'receiverName', label: '收件人姓名', required: false, group: 'B' },
  { key: 'receiverPhone', label: '收件人电话', required: false, group: 'B' },
  { key: 'receiverAddress', label: '收件人地址', required: false, group: 'B' },
  { key: 'skuCode', label: 'SKU物品编码', required: true },
  { key: 'skuName', label: 'SKU物品名称', required: true },
  { key: 'skuQuantity', label: 'SKU发货数量', required: true },
  { key: 'skuSpec', label: 'SKU规格型号', required: false },
  { key: 'remark', label: '备注', required: false },
] as const;

export const FIELD_KEYS = ORDER_FIELDS.map(f => f.key);
