// 公共行校验：服务端权威校验，解析器与提交接口共用，避免三份副本逻辑漂移
// PRD 模块六错误码：E002 必填缺失 / E003 电话格式 / E004 数量非正数

export interface FieldError {
  fieldName: string;
  errorCode: string;
  errorReason: string;
}

// 中文错误文案 → 错误码映射（与结构化校验共用）
export function validateOrderRow(data: Record<string, string>): string[] {
  return validateOrderRowDetail(data).map(e => e.errorReason);
}

// 结构化校验：返回字段级错误（PRD 模块六：field_name + error_code + error_reason）
export function validateOrderRowDetail(data: Record<string, string>): FieldError[] {
  const errors: FieldError[] = [];

  // A组/B组二选一：收货门店 或 收件人姓名+电话+地址
  const hasA = !!(data.receiverStore);
  const hasB = !!(data.receiverName && data.receiverPhone && data.receiverAddress);
  if (!hasA && !hasB) {
    errors.push({
      fieldName: 'receiverStore',
      errorCode: 'E002',
      errorReason: '收货信息缺失：需填写收货门店(A组)或收件人姓名+电话+地址(B组)',
    });
  }

  // 必填校验（E002）
  if (!data.skuCode) {
    errors.push({ fieldName: 'skuCode', errorCode: 'E002', errorReason: 'SKU物品编码不能为空' });
  }
  if (!data.skuName) {
    errors.push({ fieldName: 'skuName', errorCode: 'E002', errorReason: 'SKU物品名称不能为空' });
  }
  if (!data.skuQuantity) {
    errors.push({ fieldName: 'skuQuantity', errorCode: 'E002', errorReason: 'SKU发货数量不能为空' });
  }

  // 数量校验（E004）
  if (data.skuQuantity) {
    const qty = parseFloat(data.skuQuantity);
    if (isNaN(qty) || qty <= 0) {
      errors.push({ fieldName: 'skuQuantity', errorCode: 'E004', errorReason: 'SKU发货数量必须为正数' });
    }
  }

  // 电话格式（E003，手机或固话）
  if (data.receiverPhone) {
    const phone = data.receiverPhone.replace(/\s/g, '');
    if (!/^1[3-9]\d{9}$/.test(phone) && !/^0\d{2,3}-?\d{7,8}$/.test(phone)) {
      errors.push({ fieldName: 'receiverPhone', errorCode: 'E003', errorReason: '收件人电话格式不正确' });
    }
  }

  return errors;
}
