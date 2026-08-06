/**
 * PRD 模块一：压测数据自动准备脚本
 * 用法：npm run seed:sku
 *
 * 功能：
 * 1. 清理压测用 SKU 主数据（sku_code 以 SKU_ 开头）
 * 2. 插入 20,000 条 SKU 主数据（SKU_00001 ~ SKU_20000，含名称/规格/单位）
 * 3. 生成 10,000 行运单 Excel 压测文件 test-data/10000-orders.xlsx
 * 4. 压测文件 SKU 从主数据随机抽取，故意插入少量非法 SKU / 非法电话 / 非法数量
 * 5. 生成并保存配套解析规则（load-test-rule），压测时直接选用
 *
 * 清理策略（可重复执行）：
 * - SKU 主数据：删除 sku_code LIKE 'SKU_%' 后重建，重复执行不会无限增长
 * - 压测文件：覆盖 test-data/10000-orders.xlsx
 * - 解析规则：按 name='load-test-rule' 删除后重建
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { mkdirSync } from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const SKU_COUNT = 20_000;
const ORDER_ROWS = 10_000;
const TEST_DATA_DIR = path.join(process.cwd(), 'test-data');
const EXCEL_PATH = path.join(TEST_DATA_DIR, '10000-orders.xlsx');

// 故意注入的错误数量
const INVALID_SKU_COUNT = 20;   // 不存在的 SKU（E001）
const INVALID_PHONE_COUNT = 15; // 电话格式错误（E003）
const INVALID_QTY_COUNT = 10;   // 数量非正数（E004）
const EMPTY_SKU_COUNT = 5;      // 必填缺失（E002）

function pad(n: number): string {
  return String(n).padStart(5, '0');
}

async function seedSkuMaster(): Promise<void> {
  console.log(`[1/4] 清理旧压测 SKU 主数据...`);
  const deleted = await prisma.skuMaster.deleteMany({
    where: { skuCode: { startsWith: 'SKU_' } },
  });
  console.log(`     已清理 ${deleted.count} 条`);

  console.log(`[2/4] 插入 ${SKU_COUNT} 条 SKU 主数据...`);
  const BATCH = 2000;
  for (let start = 1; start <= SKU_COUNT; start += BATCH) {
    const end = Math.min(start + BATCH - 1, SKU_COUNT);
    const data = [];
    for (let i = start; i <= end; i++) {
      data.push({
        skuCode: `SKU_${pad(i)}`,
        name: `测试商品${pad(i)}`,
        spec: `规格${(i % 50) + 1}`,
        unit: ['件', '箱', '个', '套'][i % 4],
      });
    }
    await prisma.skuMaster.createMany({ data, skipDuplicates: true });
    console.log(`     已插入 SKU_${pad(start)} ~ SKU_${pad(end)}`);
  }
  const total = await prisma.skuMaster.count({ where: { skuCode: { startsWith: 'SKU_' } } });
  console.log(`     SKU 主数据总数: ${total}`);
}

function generateOrdersExcel(): void {
  console.log(`[3/4] 生成 ${ORDER_ROWS} 行运单压测文件...`);
  mkdirSync(TEST_DATA_DIR, { recursive: true });

  const rows: Record<string, string>[] = [];
  // 记录故意注入的错误行，便于验证
  const invalidSkus = new Set<number>();
  const invalidPhones = new Set<number>();
  const invalidQtys = new Set<number>();
  const emptySkus = new Set<number>();

  for (let i = 1; i <= ORDER_ROWS; i++) {
    const skuNum = (Math.floor(Math.random() * SKU_COUNT) + 1) % SKU_COUNT + 1;
    const phoneNum = 13800000000 + Math.floor(Math.random() * 900000000);

    let skuCode = `SKU_${pad(skuNum)}`;
    let phone = String(phoneNum);
    let qty = String(Math.floor(Math.random() * 50) + 1);

    // 按比例注入非法数据（保证每类错误至少出现）
    if (i <= INVALID_SKU_COUNT) { skuCode = `SKU_99999_${pad(i)}`; invalidSkus.add(i); }
    if (i > INVALID_SKU_COUNT && i <= INVALID_SKU_COUNT + INVALID_PHONE_COUNT) { phone = '12345'; invalidPhones.add(i); }
    if (i > INVALID_SKU_COUNT + INVALID_PHONE_COUNT && i <= INVALID_SKU_COUNT + INVALID_PHONE_COUNT + INVALID_QTY_COUNT) { qty = '-5'; invalidQtys.add(i); }
    if (i > INVALID_SKU_COUNT + INVALID_PHONE_COUNT + INVALID_QTY_COUNT && i <= INVALID_SKU_COUNT + INVALID_PHONE_COUNT + INVALID_QTY_COUNT + EMPTY_SKU_COUNT) { skuCode = ''; emptySkus.add(i); }

    // 表头必须与 load-test-rule 的中文列名映射一致（避免 smartMatch 字段错位）
    rows.push({
      '外部编码': `SO${String(i).padStart(8, '0')}`,
      '收货门店': `门店${(i % 200) + 1}`,
      '收件人姓名': `收货人${(i % 500) + 1}`,
      '收件人电话': phone,
      '收件人地址': `测试省测试市测试区测试街道${(i % 1000) + 1}号`,
      'SKU物品编码': skuCode,
      'SKU物品名称': `测试商品${pad(skuNum)}`,
      'SKU发货数量': qty,
      'SKU规格型号': `规格${(skuNum % 50) + 1}`,
      '备注': `压测数据行${i}`,
    });
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '运单数据');
  // 压缩写入（bookSST 共享字符串 + zip 压缩）：文件体积从 ~4.7MB 降到 ~1.7MB，
  // 满足 Vercel Serverless 函数 4.5MB 请求体限制（PRD 3.1 大文件约束）
  XLSX.writeFile(wb, EXCEL_PATH, { compression: true, bookSST: true });

  console.log(`     已生成 ${EXCEL_PATH}`);
  console.log(`     其中故意注入: 非法SKU ${invalidSkus.size} 行, 非法电话 ${invalidPhones.size} 行, 非法数量 ${invalidQtys.size} 行, 空SKU ${emptySkus.size} 行`);
}

async function seedParseRule(): Promise<void> {
  console.log(`[4/4] 生成配套解析规则 load-test-rule...`);
  // 清理旧规则，保证可重复执行
  await prisma.parseRule.deleteMany({ where: { name: 'load-test-rule' } });

  const rule = {
    name: 'load-test-rule',
    fileType: 'excel',
    strategy: 'standard',
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow: 0,
    mappings: [
      { source: '外部编码', target: 'externalCode' },
      { source: '收货门店', target: 'receiverStore' },
      { source: '收件人姓名', target: 'receiverName' },
      { source: '收件人电话', target: 'receiverPhone' },
      { source: '收件人地址', target: 'receiverAddress' },
      { source: 'SKU物品编码', target: 'skuCode' },
      { source: 'SKU物品名称', target: 'skuName' },
      { source: 'SKU发货数量', target: 'skuQuantity' },
      { source: 'SKU规格型号', target: 'skuSpec' },
      { source: '备注', target: 'remark' },
    ],
  };

  await prisma.parseRule.create({
    data: {
      name: rule.name,
      description: '压测用规则：10,000 行运单文件',
      fileType: 'excel',
      ruleJson: JSON.stringify(rule),
    },
  });
  console.log(`     规则 load-test-rule 已保存`);
}

async function main() {
  try {
    await seedSkuMaster();
    generateOrdersExcel();
    await seedParseRule();
    console.log('\n✅ 压测数据准备完成');
    console.log(`  - SKU 主数据: ${SKU_COUNT} 条 (SKU_00001 ~ SKU_${pad(SKU_COUNT)})`);
    console.log(`  - 压测文件: ${EXCEL_PATH} (${ORDER_ROWS} 行)`);
    console.log(`  - 解析规则: load-test-rule`);
    console.log('\n清理策略: 重新执行本脚本即可重置（SKU 按前缀 SKU_ 删除重建，Excel 覆盖，规则按 name 删除重建）');
  } catch (err) {
    console.error('压测数据准备失败:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
