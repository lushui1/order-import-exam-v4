// LLM调用封装 - 用于AI生成解析规则

const LLM_API_URL = process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

export async function callLLM(prompt: string): Promise<string> {
  if (!LLM_API_KEY) {
    throw new Error('LLM_API_KEY 未配置');
  }
  
  const response = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    }),
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API错误: ${response.status} ${err}`);
  }
  
  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

const SYSTEM_PROMPT = `你是一个文件结构分析专家。你的任务是分析文件内容，生成一个JSON格式的解析规则。

目标字段（必须映射到这些字段）：
- externalCode: 外部编码（配送单号等）
- receiverStore: 收货门店
- receiverName: 收件人姓名
- receiverPhone: 收件人电话
- receiverAddress: 收件人地址
- skuCode: SKU物品编码
- skuName: SKU物品名称
- skuQuantity: SKU发货数量
- skuSpec: SKU规格型号
- remark: 备注

规则格式要求：
{
  "name": "规则名称",
  "fileType": "excel",
  "strategy": "standard",
  "headerRow": 4,
  "dataStartRow": 5,
  "dataEndRow": 0,
  "skipRows": [1, 2, 3],
  "sheetSelection": "all",
  "mappings": [
    { "source": "列名或列号(A,B,C...)", "target": "目标字段名" }
  ],
  "tailSections": [
    {
      "rowStart": 9,
      "rowEnd": 10,
      "patterns": [
        { "regex": "收货人[：:]\\s*(\\S+)", "target": "receiverName" },
        { "regex": "收货电话[：:]\\s*(\\d+)", "target": "receiverPhone" }
      ]
    }
  ],
  "groupBy": "externalCode",
  "shareFields": ["receiverName", "receiverPhone", "receiverAddress"]
}

复杂结构处理：
- 卡片式: strategy="card_based", 需要cardConfig
- 多Sheet: sheetSelection="all", 每个Sheet独立解析后合并
- 矩阵转置: 需要matrixConfig
- 纯文本: fileType="word", strategy="text_parse"

重要规则：
1. 不要硬编码特定文件名，规则必须是通用的
2. mappings中的source可以是列名（如"物品编码"）或列号（如"C"）
3. 收货信息如果在数据区之外，用tailSections提取
4. 如果同一配送单号有多行物品，用groupBy聚合
5. 必须输出合法的JSON，不要包含其他文字`;

// 生成AI分析提示词
export function buildAnalyzePrompt(filePreview: string, fileName: string): string {
  return `请分析以下文件内容，生成解析规则。

文件名: ${fileName}

文件内容预览:
${filePreview}

请生成一个JSON格式的解析规则，要求：
1. 分析表头结构，确定数据区起止行
2. 识别列名并映射到目标字段
3. 如果收货信息在数据区之外（如尾部），配置tailSections
4. 如果同一单号有多行数据，配置groupBy和shareFields
5. 如果是多Sheet文件，设置sheetSelection="all"
6. 如果是卡片式结构（如"▶ 记录#N"），设置strategy="card_based"

只输出JSON，不要其他文字。`;
}
