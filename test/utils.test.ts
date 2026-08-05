import { describe, it, expect } from 'vitest';
import { maskPhone, maskName, maskAddress, maskValue } from '@/lib/masking';
import { buildEvent, newEventId } from '@/lib/events';
import { splitBatches } from '@/lib/import-task-service';
import { safeRegExp } from '@/lib/rule-engine/safe-regex';

describe('PRD 考点4：敏感数据脱敏', () => {
  it('手机号脱敏：138****5678', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
  });

  it('姓名脱敏：欧阳娜娜 → 欧阳**', () => {
    expect(maskName('欧阳娜娜')).toBe('欧阳**');
  });

  it('地址脱敏保留前6字', () => {
    const masked = maskAddress('浙江省杭州市西湖区文三路100号');
    expect(masked.startsWith('浙江省杭州市')).toBe(true);
    expect(masked.includes('*')).toBe(true);
  });

  it('maskValue 按字段名分派', () => {
    expect(maskValue('receiverPhone', '13812345678')).toBe('138****5678');
    expect(maskValue('skuCode', 'SKU_00001')).toBe('SKU_00001'); // 非敏感字段不脱敏
  });
});

describe('PRD 9.1：事件信封', () => {
  it('信封包含 schema_version / aggregate_id / trace_id / occurred_at', () => {
    const evt = buildEvent('ImportBatchCreated', 'task_1', 'trace_1', { task_id: 'task_1' });
    expect(evt.schema_version).toBe(1);
    expect(evt.aggregate_id).toBe('task_1');
    expect(evt.trace_id).toBe('trace_1');
    expect(evt.event_type).toBe('ImportBatchCreated');
    expect(new Date(evt.occurred_at).getTime()).not.toBeNaN();
  });

  it('event_id 唯一', () => {
    expect(newEventId()).not.toBe(newEventId());
  });
});

describe('PRD 4.1：处理单元划分', () => {
  it('10000 行 / 1000 每批 = 10 批', () => {
    const batches = splitBatches(10000, 1000);
    expect(batches.length).toBe(10);
    expect(batches[0].startRow).toBe(1);
    expect(batches[0].endRow).toBe(1000);
    expect(batches[9].endRow).toBe(10000);
  });

  it('unitId 唯一且递增', () => {
    const batches = splitBatches(2500, 1000);
    const ids = batches.map(b => b.unitId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(batches[0].unitId).toBe('unit_001');
    expect(batches[2].unitId).toBe('unit_003');
  });

  it('不足一批时仅 1 批', () => {
    expect(splitBatches(500, 1000).length).toBe(1);
  });
});

describe('PRD 安全：正则防护', () => {
  it('合法正则正常编译', () => {
    expect(safeRegExp('收货人[：:]\\s*(\\S+)')).not.toBeNull();
  });

  it('危险嵌套量词被拒绝（ReDoS）', () => {
    expect(safeRegExp('(a+)+$')).toBeNull();
    expect(safeRegExp('(.*)*$')).toBeNull();
  });

  it('非法正则返回 null', () => {
    expect(safeRegExp('(')).toBeNull();
  });

  it('超长正则被拒绝', () => {
    expect(safeRegExp('a'.repeat(300))).toBeNull();
  });
});
