#!/usr/bin/env node

import { Command } from 'commander';
import { translate, printTranslateSummary } from './translate.js';
import { getLanguageFiles, printLanguageInfo, syncDeleteFieldsFromAllLanguages } from './file-processor.js';
import { simpleDiff, deleteFieldByPath, readJsonFile, saveJsonFile, backupFile } from './diff.js';
import { resolve } from 'path';
import { getLanguageName } from './ai.js';
import * as cliProgress from 'cli-progress';

const program = new Command();

// 版本信息
program
  .name('ai-translator')
  .description('AI驱动的i18n文件自动翻译工具')
  .version('1.0.0');

// 一键翻译命令
program
  .command('auto')
  .description('一键自动翻译：检查差异 -> 翻译 -> 备份')
  .action(async (options: any) => {
    try {
      console.log('🚀 一键自动翻译模式');
      var workspace = ''
      var temp = ''
      if (process.env.is_test_mode) {
        workspace = process.env.test_workspace!
        temp = process.env.test_work_temp!
      } else {
        workspace = process.env.workspace!
        temp = process.env.work_temp!
      }
      // 1. 检查翻译状态
      const languageFiles = await getLanguageFiles(workspace);
      printLanguageInfo(languageFiles);

      const enFile = languageFiles.find(f => f.code === 'en');
      if (!enFile) {
        console.log('❌ 未找到 en.json 文件');
        process.exit(1);
      }

      // 2. 检查是否有内容需要翻译
      const oldEnFilePath = resolve(process.cwd(), temp, 'en_old.json');
      const { existsSync, readFileSync } = await import('fs');
      const isFirstTime = !existsSync(oldEnFilePath);

      let shouldTranslate = false;
      let deletedFields: any[] = [];


      // 无论是否首次运行，都检查差异
      const diffResult = simpleDiff(oldEnFilePath, enFile.path);

      // 打印差异报告
      if (diffResult.missing.length > 0 || diffResult.added.length > 0 || diffResult.changed.length > 0) {
        console.log(`\n📊 检测到变化: +${diffResult.added.length} ~${diffResult.changed.length} -${diffResult.missing.length}`);
      }

      // 检查是否有被删除的字段，如果有则同步删除其他语言文件中的相应字段
      if (diffResult.missing.length > 0) {
        deletedFields = diffResult.missing.map(key => ({
          key,
          path: [key]
        }));

        if (deletedFields.length > 0) {
          const deleteResult = syncDeleteFieldsFromAllLanguages(languageFiles, deletedFields);

          if (deleteResult.success) {
            // 同时从 en_old.json 中删除这些字段
            let backupData = readJsonFile(oldEnFilePath);

            let deletedCount = 0;
            for (const field of deletedFields) {
              if (deleteFieldByPath(backupData, field.path)) {
                deletedCount++;
              }
            }

            if (deletedCount > 0) {
              saveJsonFile(oldEnFilePath, backupData);
            }
          }
        }
      }

      // 检查是否为首次运行或 en_old.json 为空
      let isOldFileEmpty = false;
      if (!isFirstTime && existsSync(oldEnFilePath)) {
        try {
          const oldContent = readFileSync(oldEnFilePath, 'utf-8');
          const oldData = JSON.parse(oldContent);
          isOldFileEmpty = Object.keys(oldData).length === 0;
        } catch (error) {
          console.log(`⚠️  无法读取 en_old.json，将视为首次翻译: ${error}`);
          isOldFileEmpty = true;
        }
      }

      // 如果是首次运行、en_old.json 为空，或者有新增/修改的内容，则需要翻译
      if (isFirstTime) {
        console.log('\n🎯 首次翻译：将翻译所有内容');
        shouldTranslate = true;
      } else if (isOldFileEmpty && diffResult.missing.length > 0) {
        // en_old.json 为空但 en.json 有内容（显示为删除项）
        shouldTranslate = true;
      } else if ((diffResult.added.length > 0 || diffResult.changed.length > 0)) {
        shouldTranslate = true;
      } else if (diffResult.missing.length > 0 && diffResult.added.length === 0 && diffResult.changed.length === 0) {
        // 特殊情况：只有删除项，但实际可能是en_old.json只包含部分内容
        // 检查en.json的内容是否比en_old.json多
        try {
          const currentData = JSON.parse(readFileSync(enFile.path, 'utf-8'));
          const oldData = JSON.parse(readFileSync(oldEnFilePath, 'utf-8'));
          const currentKeyCount = Object.keys(currentData).length;
          const oldKeyCount = Object.keys(oldData).length;

          if (currentKeyCount > oldKeyCount) {
            shouldTranslate = true;
          } else {
            console.log('\n✅ 没有检测到需要翻译的内容');
            process.exit(0);
          }
        } catch (error) {
          process.exit(0);
        }
      } else {
        console.log('\n✅ 没有检测到需要翻译的内容');
        process.exit(0);
      }


      if (shouldTranslate) {
        // 3. 执行翻译
        console.log('\n🌍 开始翻译...');
        
        // 创建进度条
        const targetLanguages = languageFiles.filter(f => f.code !== 'en').map(f => f.code);
        
        // 计算总组数
        const enData = JSON.parse(require('fs').readFileSync(enFile.path, 'utf-8'));
        let totalGroups = 0;
        for (const [key, value] of Object.entries(enData)) {
          if (typeof value === 'object' && value !== null) {
            totalGroups++;
          } else {
            totalGroups++; // 每个非对象值也算一个组
          }
        }
        
        const totalSteps = 2 + (targetLanguages.length * totalGroups); // 2 = 初始化+摘要
        
        // 创建多进度条实例
        const progressBar = new cliProgress.MultiBar(
          {
            clearOnComplete: false,
            hideCursor: true,
            format: '翻译进度 |{bar}| {percentage}% | {value}/{total} | {status}',
          },
          cliProgress.Presets.shades_grey
        );
        
        const mainBar = progressBar.create(totalSteps, 0, { status: '初始化翻译环境' });

        const result = await translate({
          messageDir:workspace,
          tempDir:temp,
          onLanguageComplete: (languageCode: string, groupName?: string) => {
            const languageName = getLanguageName(languageCode);
            if (groupName) {
              mainBar.increment(1, { status: `${languageName} - ${groupName} 组完成` });
            } else {
              mainBar.increment(1, { status: `完成 ${languageName} 翻译` });
            }
          }
        });

        mainBar.increment(1, { status: '生成翻译摘要' });
        progressBar.stop();
        printTranslateSummary(result);

        if (result.success) {
          // 4. 备份当前状态
          // 先备份当前文件
          const backupSuccess = backupFile(enFile.path, oldEnFilePath);

          // 如果有被删除的字段，也需要从备份文件中删除
          if (deletedFields.length > 0) {
            let backupData = readJsonFile(oldEnFilePath);

            let deletedCount = 0;
            for (const field of deletedFields) {
              if (deleteFieldByPath(backupData, field.path)) {
                deletedCount++;
              }
            }

            if (deletedCount > 0) {
              saveJsonFile(oldEnFilePath, backupData);
            }
          }

          if (backupSuccess) {
            console.log('\n✅ 翻译完成！下次将进行增量翻译');
          } else {
            console.log('\n✅ 翻译完成！（备份失败，但不影响翻译结果）');
          }
          process.exit(0);
        } else {
          console.log('\n💥 翻译失败！');
          process.exit(1);
        }
      }

    } catch (error) {
      console.error(`❌ 一键翻译失败: ${error}`);
      process.exit(1);
    }
  });

// 错误处理
program.on('command:*', () => {
  console.error('❌ 未知命令，使用 --help 查看可用命令');
  process.exit(1);
});

// 解析命令行参数
program.parse();

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}