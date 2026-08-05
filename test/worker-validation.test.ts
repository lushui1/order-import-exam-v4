import { describe, it, expect } from 'vitest';
import { validateOrderRowDetail } from '@/lib/rule-engine/validation';
import { classifyRows } from '@/lib/batch-processor';
import type { ParsedRow } from '@/lib/rule-engine/types';

function makeRow(rowIndex: number, data: Record<string, string>): ParsedRow {
  return { rowIndex, data, errors: [] };
}

describe('PRD 模块六：结构化错误码校验', () => {
  it('E002: 必填字段缺失（SKU 编码/名称/数量）', () => {
    const errors = validateOrderRowDetail({});
    expect(errors.some(e => e.errorCode === 'E002' && e.fieldName === 'skuCode')).toBe(true);
    expect(errors.some(e => e.errorCode === 'E002' && e.fieldName === 'skuName')).toBe(true);
    expect(errors.some(e => e.errorCode === 'E002' && e.fieldName === 'skuQuantity')).toBe(true);
  });

  it('E003: 电话格式错误', () => {
    const errors = validateOrderRowDetail({
      receiverStore: '门店A',
      skuCode: 'SKU_00001',
      skuName: '商品',
      skuQuantity: '10',
      receiverPhone: '12345',
    });
    expect(errors.some(e => e.errorCode === 'E003')).toBe(true);
  });

  it('E004: 数量非正数', () => {
    const errors = validateOrderRowDetail({
      receiverStore: '门店A',
      skuCode: 'SKU_00001',
      skuName: '商品',
      skuQuantity: '-5',
    });
    expect(errors.some(e => e.errorCode === 'E004')).toBe(true);
  });

  it('合法行无错误', () => {
    const errors = validateOrderRowDetail({
      receiverStore: '门店A',
      skuCode: 'SKU_00001',
      skuName: '商品',
      skuQuantity: '10',
    });
    expect(errors.length).toBe(0);
  });
});

describe('PRD 模块四/五：批次校验分类（成功行/失败行）', () => {
  const skuMap = new Map<string, boolean>([['SKU_00001', true]]);

  it('E001: SKU 不存在被标记，成功行不受影响（部分行失败）', () => {
    const rows = [
      makeRow(1, { receiverStore: 'A', skuCode: 'SKU_00001', skuName: 'x', skuQuantity: '1' }),
      makeRow(2, { receiverStore: 'A', skuCode: 'SKU_BAD', skuName: 'x', skuQuantity: '1' }),
    ];
    const { successRows, rowErrors } = classifyRows(rows, skuMap, false);
    expect(successRows.length).toBe(1);
    expect(rowErrors[2].some(e => e.errorCode === 'E001')).toBe(true);
  });

  it('E005: 批内外部编码重复', () => {
    const rows = [
      makeRow(1, { receiverStore: 'A', externalCode: 'SO001', skuCode: 'SKU_00001', skuName: 'x', skuQuantity: '1' }),
      makeRow(2, { receiverStore: 'A', externalCode: 'SO001', skuCode: 'SKU_00001', skuName: 'x', skuQuantity: '1' }),
    ];
    const { successRows, rowErrors } = classifyRows(rows, skuMap, false);
    expect(successRows.length).toBe(1);
    expect(rowErrors[2].some(e => e.errorCode === 'E005')).toBe(true);
  });

  it('降级模式下跳过 SKU 校验（PRD 模块十）', () => {
    const rows = [
      makeRow(1, { receiverStore: 'A', skuCode: 'SKU_UNKNOWN', skuName: 'x', skuQuantity: '1' }),
    ];
    // 降级：skuMap 为空也视为通过
    const { successRows, rowErrors } = classifyRows(rows, new Map(), true);
    expect(successRows.length).toBe(1);
    expect(rowErrors[1]).toBeUndefined();
  });

  it('重复消费同一批次输入一致（幂等基础：纯函数无副作用）', () => {
    const rows = [
      makeRow(1, { receiverStore: 'A', skuCode: 'SKU_00001', skuName: 'x', skuQuantity: '1' }),
      makeRow(2, { receiverStore: 'A', skuCode: 'SKU_BAD', skuName: 'x', skuQuantity: '1' }),
    ];
    const r1 = classifyRows(rows, skuMap, false);
    const r2 = classifyRows(rows, skuMap, false);
    expect(r1.successRows.length).toBe(r2.successRows.length);
    expect(Object.keys(r1.rowErrors)).toEqual(Object.keys(r2.rowErrors));
  });
});
