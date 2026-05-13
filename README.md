# AI自动翻译工具

该项目主要用于处理 i18n 语言文件的翻译问题，支持多种 AI 模型、增量翻译、自动备份和多语言。

## 特性

- **AI驱动翻译**：支持 GLM（智谱）和 DeepSeek 等多种 AI 模型，提供高质量的翻译结果
- **增量翻译**：智能检测文件变化，只翻译新增或修改的内容，保留已有翻译
- **多语言支持**：支持简体中文、法语、德语、西班牙语、意大利语等11种语言
- **批量处理**：支持嵌套 JSON 对象分组翻译和简单扁平 JSON 行分组翻译
- **自动同步删除**：从源文件删除字段时，自动同步从其他语言文件中删除对应字段

## 项目结构

```
ai-translator/
├── src/                    # 源代码目录
│   ├── types.ts            # 类型定义（所有接口、枚举、类型别名集中管理）
│   ├── ai.ts               # AI 通信层（GLMHandler、DSHandler、callAI）
│   ├── cli.ts              # 命令行入口（Commander 命令定义）
│   ├── config.ts           # 语言映射配置
│   ├── diff.ts             # 对象差异比较工具
│   ├── file-processor.ts   # 文件 I/O 与分组处理
│   └── translate.ts        # 翻译编排引擎（翻译流程一站式管理）
├── test-workspace/         # 测试环境语言文件目录
├── .env.template           # 配置文件模板
├── package.json            # 项目配置
└── README.md               # 项目说明
```

## 目录

- [安装](#安装)
- [配置](#配置)
- [用法](#用法)
- [支持的语言](#支持的语言)
- [工作原理](#工作原理)
- [常见问题](#常见问题)

## 安装

1. **克隆仓库：**
```bash
git clone https://github.com/muliqunluan/ai-translator.git
cd ai-translator
```

2. **安装 Bun 运行时：**
```bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# macOS/Linux
curl -fsSL https://bun.sh/install | bash
```

3. **安装项目依赖：**
```bash
bun install
```

## 配置

1. **复制配置模板文件：**
```bash
cp .env.template .env
```

2. **修改 `.env` 文件，填入你的AI API配置：**
```env
# AI模型类型 (glm 或 ds)
ai = glm

# API密钥
apikey = your_api_key_here

# API地址
# GLM: https://open.bigmodel.cn/api/paas/v4/chat/completions
# DeepSeek: https://api.deepseek.com/v1
url = https://open.bigmodel.cn/api/paas/v4/chat/completions

# 模型编码
# GLM: glm-4.5
# DeepSeek: deepseek-chat
module = glm-4.5

# 其他配置
max_tokens = 4096
temperature = 0.6

# 工作模式设置
is_test_mode = true  # true使用test-workspace文件夹，false使用workspace文件夹
workspace = workspace
work_temp = workspace/temp
test_workspace = test-workspace
test_work_temp = test-workspace/temp
```

## 用法

### 基本使用

1. **准备语言文件：**
   - 将你的英文源文件 `en.json` 放入 `workspace/` 文件夹（需手动创建）或 `test-workspace/` 文件夹（测试环境）
   - 创建其他语言的空JSON文件（如 `zh-CN.json`, `fr.json`, `de.json` 等）

2. **运行自动翻译：**
```bash
bun run src/cli.ts auto
```

### 支持的文件格式

工具支持两种 JSON 文件格式：

**嵌套对象格式（每组一个顶层键）：**
```json
{
  "common": {
    "welcome": "Welcome",
    "goodbye": "Goodbye"
  },
  "navigation": {
    "home": "Home",
    "about": "About"
  }
}
```

**简单扁平格式（所有键在同一层级）：**
```json
{
  "loading": "Loading...",
  "save": "Save",
  "delete": "Delete"
}
```
对于扁平 JSON，工具会自动按行分组（每20行一组）进行翻译，避免单次请求数据量过大导致翻译质量下降。

### 更多

#### 测试模式
在 `.env` 文件中设置 `is_test_mode = true`，工具将使用 `test-workspace` 文件夹作为工作区，适合快速测试翻译效果。

#### 生产模式
在 `.env` 文件中设置 `is_test_mode = false`，工具将使用 `workspace` 文件夹作为工作区，用于正式翻译。

## 支持的语言

| 语言代码 | 语言名称 | 文件名 |
|---------|---------|--------|
| zh-CN | 简体中文 | zh-CN.json |
| fr | 法语 | fr.json |
| de | 德语 | de.json |
| es | 西班牙语 | es.json |
| it | 意大利语 | it.json |
| nl | 荷兰语 | nl.json |
| pl | 波兰语 | pl.json |
| se | 瑞典语 | se.json |
| dk | 丹麦语 | dk.json |
| cz | 捷克语 | cz.json |
| be | 白俄罗斯语 | be.json |

## 工作原理

1. **差异检测**：比较当前 `en.json` 与备份文件 `en_old.json`，检测新增、修改和删除的字段
2. **同步删除**：自动从其他语言文件中删除在源文件中已删除的字段，同时从备份文件中同步删除
3. **增量翻译**：
   - **首次运行**：翻译所有内容，生成 `en_old.json` 备份
   - **增量运行**：只翻译新增或修改的字段，原有翻译保持不变
4. **智能分组**：
   - 嵌套 JSON → 按顶层键分组翻译
   - 扁平 JSON → 按行分组（每20行一组），提高长文件的翻译质量

## 常见问题

### Q: 如何添加新的支持语言？
A: 在 [`src/config.ts`](src/config.ts) 文件中的 `LANGUAGE_MAP` 对象中添加新的语言映射，然后创建对应的JSON文件。

### Q: 如何切换AI模型？
A: 在 `.env` 文件中修改 `ai` 参数：
- 设置为 `glm` 使用智谱AI模型
- 设置为 `ds` 使用DeepSeek模型
同时确保 `url` 和 `module` 参数对应所选模型的正确配置。

### Q: 翻译失败怎么办？
A: 检查以下几点：
1. AI模型类型配置是否正确
2. API密钥是否正确
3. API地址是否与所选模型匹配
4. 网络连接是否正常
5. 源文件格式是否正确
6. 查看终端输出的错误信息

### Q: 如何重新翻译所有内容？
A: 删除 `workspace/temp/en_old.json` 文件（或 `test-workspace/temp/en_old.json`），然后重新运行翻译命令。

### Q: 支持自定义翻译提示词吗？
A: 目前工具使用内置的翻译提示词，确保翻译的一致性和质量。

### Q: 增量翻译时会不会丢失已有翻译？
A: 不会。增量翻译采用合并策略，每次只会添加或更新新增/修改的字段，**不会替换**已有的翻译内容。

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request来改进这个项目！

---

**注意**：使用本工具需要有效的AI API密钥，请确保遵守相关API的使用条款。
