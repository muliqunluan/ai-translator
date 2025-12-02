import { readFileSync } from 'fs';
import { resolve } from 'path';

// 配置接口
interface AIConfig {
  apikey: string;
  url: string;
  module: string;
  max_tokens: number;
  temperature: number;
}

// 翻译请求接口
interface TranslationRequest {
  text: string;
  targetLanguage: string;
  context?: string;
}

// 翻译响应接口
interface TranslationResponse {
  success: boolean;
  translatedText?: string;
  error?: string;
}

// 语言映射
const LANGUAGE_MAP: Record<string, string> = {
  'zh-CN': '简体中文',
  'fr': '法语',
  'de': '德语',
  'es': '西班牙语',
  'it': '意大利语',
  'nl': '荷兰语',
  'pl': '波兰语',
  'se': '瑞典语',
  'dk': '丹麦语',
  'cz': '捷克语',
  'be': '白俄罗斯语'
};

// 读取配置
function loadConfig(): AIConfig {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');

    const config: Partial<AIConfig> = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        switch (key.trim()) {
          case 'apikey':
            config.apikey = value;
            break;
          case 'url':
            config.url = value;
            break;
          case 'module':
            config.module = value;
            break;
          case 'max_tokens':
            config.max_tokens = parseInt(value);
            break;
          case 'temperature':
            config.temperature = parseFloat(value);
            break;
        }
      }
    });

    if (!config.apikey || !config.url) {
      throw new Error('Missing required API configuration (apikey or url)');
    }

    return {
      apikey: config.apikey!,
      url: config.url!,
      module: config.module || 'glm-4.5',
      max_tokens: config.max_tokens || 4096,
      temperature: config.temperature || 0.6
    };
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error}`);
  }
}

// API响应接口
interface APIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// 调用AI翻译
async function callAI(config: AIConfig, prompt: string): Promise<string> {
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apikey}`
      },
      body: JSON.stringify({
        model: config.module,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: config.max_tokens,
        temperature: config.temperature,
        "thinking": {
          "type": "disabled"
        },
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as APIResponse;

    if (data.choices && data.choices.length > 0 && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    } else {
      throw new Error('Invalid API response format');
    }
  } catch (error) {
    throw new Error(`AI API call failed: ${error}`);
  }
}

// 翻译文本
export async function translateText(request: TranslationRequest): Promise<TranslationResponse> {
  try {
    const config = loadConfig();
    const prompt = request.context!;

    const translatedText = await callAI(config, prompt);

    // 验证翻译结果
    if (!translatedText || translatedText.trim().length === 0) {
      throw new Error('翻译结果为空');
    }

    return {
      success: true,
      translatedText
    };
  } catch (error) {
    return {
      success: false,
      error: `Translation failed: ${error}`
    };
  }
}

// 批量翻译文本对象
export async function translateTextObject(
  textObject: Record<string, string>,
  targetLanguage: string,
  context?: string
): Promise<Record<string, string>> {
  // 构建整组翻译的JSON字符串
  const jsonString = JSON.stringify(textObject, null, 2);

  // 构建整组翻译的提示词
  const groupContext = `${context || ''}

请将以下JSON对象中的所有值从英文翻译成${getLanguageName(targetLanguage)}。

翻译要求：
1. 只翻译值（values），保持键（keys）不变
2. 保持JSON格式不变
3. 对于占位符（如 {{name}}, {{field}} 等），请保持不变
4. 对于技术术语，使用标准的${getLanguageName(targetLanguage)}翻译
5. 保持简洁明了，符合用户界面的语言习惯
6. 确保翻译的一致性和专业性

待翻译的JSON：
\`\`\`json
${jsonString}
\`\`\`

请返回完整的翻译后的JSON对象，格式与输入完全相同，只是值被翻译成${getLanguageName(targetLanguage)}。`;

  const response = await translateText({
    text: jsonString,
    targetLanguage,
    context: groupContext
  });

  if (!response.success || !response.translatedText) {
    throw new Error(`整组翻译失败: ${response.error}`);
  }

  // 解析翻译后的JSON
  try {
    // 清理可能的markdown代码块标记
    let cleanText = response.translatedText.trim();

    // 移除可能的markdown代码块标记
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.substring(7);
    }
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.substring(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();

    // 尝试多种方式解析JSON
    let translatedObject;
    try {
      translatedObject = JSON.parse(cleanText);
    } catch (firstError: any) {
      // 尝试修复常见的JSON问题
      let fixedText = cleanText;

      // 修复尾随逗号
      fixedText = fixedText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

      // 修复单引号
      fixedText = fixedText.replace(/'/g, '"');

      // 修复未引用的键
      fixedText = fixedText.replace(/(\w+):/g, '"$1":');

      try {
        translatedObject = JSON.parse(fixedText);
      } catch (secondError: any) {
        // 最后尝试：手动提取键值对
        translatedObject = {} as Record<string, string>;
        const lines = cleanText.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/);
          if (match && match[1] && match[2]) {
            translatedObject[match[1]] = match[2];
          }
        }

        if (Object.keys(translatedObject).length === 0) {
          throw new Error('无法解析任何有效的JSON数据');
        }
      }
    }

    // 验证翻译结果
    const translatedKeys = Object.keys(translatedObject);
    const originalKeys = Object.keys(textObject);

    // 检查是否有键缺失
    for (const key of originalKeys) {
      if (!(key in translatedObject)) {
        translatedObject[key] = textObject[key];
      }
    }

    return translatedObject;

  } catch (parseError) {
    return ({});
  }
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_MAP);
}

/**
 * 获取语言名称
 */
export function getLanguageName(languageCode: string): string {
  return LANGUAGE_MAP[languageCode] || languageCode;
}
