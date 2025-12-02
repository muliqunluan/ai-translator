# 调用GLM模型实现的AI自动翻译工具

该项目主要用于处理i18n语言文件的翻译问题，支持增量翻译、自动备份和多种语言。

## 特性

- **AI驱动翻译**：基于GLM模型，提供高质量的翻译结果
- **增量翻译**：智能检测文件变化，只翻译新增或修改的内容
- **多语言支持**：支持简体中文、法语、德语、西班牙语、意大利语、荷兰语、波兰语、瑞典语、丹麦语、捷克语、白俄罗斯语
- **批量处理**：按组批量翻译，提高效率

## 项目结构

```
ai-translator/
├── src/                    # 源代码目录
│   ├── ai.ts              # AI翻译接口
│   ├── cli.ts             # 命令行入口
│   ├── config.ts             # 配置语言映射
│   ├── diff.ts            # 文件差异比较
│   ├── file-processor.ts  # 文件处理逻辑
│   └── translate.ts       # 翻译核心逻辑
├── test-workspace/          # 测试环境语言文件目录
├── .env.template          # 配置文件模板
├── package.json           # 项目配置
└── README.md             # 项目说明
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

2. **修改 `.env` 文件，填入你的GLM API配置：**
```env
# GLM的API密钥
apikey = your_glm_api_key_here

# GLM的API地址
url = https://open.bigmodel.cn/api/paas/v4/chat/completions

# 模型编码
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
2. **同步删除**：自动从其他语言文件中删除在源文件中已删除的字段
3. **内容分组**：将翻译内容按功能模块分组，提高翻译质量和一致性
4. **批量翻译**：调用AI API进行批量翻译，保持上下文一致性
5. **增量更新**：只翻译变化的内容，保留已翻译的内容不变

## 翻译文件格式

语言文件支持以下格式：

### 扁平结构
```json
{
  "welcome": "Welcome",
  "goodbye": "Goodbye"
}
```

### 嵌套结构（推荐）
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

## 常见问题

### Q: 如何添加新的支持语言？
A: 在 `src/config.ts` 文件中的 `LANGUAGE_MAP` 对象中添加新的语言映射，然后创建对应的JSON文件。

### Q: 翻译失败怎么办？
A: 检查以下几点：
1. API密钥是否正确
2. 网络连接是否正常
3. 源文件格式是否正确
4. 查看终端输出的错误信息

### Q: 如何重新翻译所有内容？
A: 删除 `workspace/temp/en_old.json` 文件，然后重新运行翻译命令。

### Q: 支持自定义翻译提示词吗？
A: 目前工具使用内置的翻译提示词，确保翻译的一致性和质量。

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request来改进这个项目！

---

**注意**：使用本工具需要有效的GLM API密钥，请确保遵守相关API的使用条款。