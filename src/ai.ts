import OpenAI from 'openai';
import { SupportAI } from './types.js';
import type { AIConfig, AIHandler, APIResponse } from './types.js';

// 读取环境配置
function loadConfig(): AIConfig {
  return {
    ai: (process.env.ai! as SupportAI) || SupportAI.GLM,
    apikey: process.env.apikey!,
    url: process.env.url!,
    module: process.env.module!,
    max_tokens: Number(process.env.max_tokens),
    temperature: Number(process.env.temperature)
  }
}

// GLM处理器
class GLMHandler implements AIHandler {
  async call(config: AIConfig, prompt: string): Promise<string> {
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
      throw new Error(`GLM API call failed: ${error}`);
    }
  }
}

// DeepSeek处理器
class DSHandler implements AIHandler {
  async call(config: AIConfig, prompt: string): Promise<string> {
    try {
      const openai = new OpenAI({
        baseURL: config.url,
        apiKey: config.apikey,
      });

      const completion = await openai.chat.completions.create({
        messages: [{
          role: "user",
          content: prompt
        }],
        model: config.module
      });
      
      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      throw new Error(`DeepSeek API call failed: ${error}`);
    }
  }
}

// AI处理器工厂
class AIHandlerFactory {
  private static handlers: Record<SupportAI, AIHandler> = {
    [SupportAI.GLM]: new GLMHandler(),
    [SupportAI.DS]: new DSHandler()
  };

  static getHandler(aiType: SupportAI): AIHandler {
    const handler = this.handlers[aiType];
    if (!handler) {
      throw new Error(`不支持的AI类型: ${aiType}`);
    }
    return handler;
  }
}

// 调用AI
async function callAI(ai: SupportAI, config: AIConfig, prompt: string): Promise<string> {
  try {
    const handler = AIHandlerFactory.getHandler(ai);
    return await handler.call(config, prompt);
  } catch (error) {
    throw new Error(`AI API call failed: ${error}`);
  }
}

export { loadConfig, callAI };
export type { SupportAI, AIConfig, AIHandler };
