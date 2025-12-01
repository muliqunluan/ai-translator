#!/usr/bin/env node

import { Command } from 'commander';
import { translate, printTranslateSummary } from './translate.js';
import type { TranslateOptions } from './translate.js';
import { getLanguageFiles, printLanguageInfo, syncDeleteFieldsFromAllLanguages } from './file-processor.js';
import { simpleDiff, deleteFieldByPath, readJsonFile, saveJsonFile, backupFile } from './diff.js';
import { getSupportedLanguages, getLanguageName } from './ai.js';
import { resolve } from 'path';

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
    .option('-f, --force', '强制翻译所有内容')
    .option('-d, --dry-run', '预览模式，只显示将要翻译的内容')
    .action(async (options: any) => {
      try {
        console.log('🚀 一键自动翻译模式');
        
        // 1. 检查翻译状态
        console.log('\n📊 第一步：检查翻译状态');
        const languageFiles = await getLanguageFiles('message');
        printLanguageInfo(languageFiles);
        
        const enFile = languageFiles.find(f => f.code === 'en');
        if (!enFile) {
          console.log('❌ 未找到 en.json 文件');
          process.exit(1);
        }
        
        // 2. 检查是否有内容需要翻译
        const oldEnFilePath = resolve(process.cwd(), 'message/temp', 'en_old.json');
        const { existsSync, readFileSync } = await import('fs');
        const isFirstTime = !existsSync(oldEnFilePath);
        
        let shouldTranslate = false;
        let deletedFields: any[] = [];
        
        if (options.force) {
          console.log('\n🔄 强制翻译模式：将翻译所有内容');
          shouldTranslate = true;
        } else {
          // 无论是否首次运行，都检查差异
          console.log('\n🔍 检查文件差异...');
          const diffResult = simpleDiff(oldEnFilePath, enFile.path);
          
          // 打印差异报告
          console.log('\n=== 文件差异报告 ===');
          if (diffResult.missing.length === 0 && diffResult.added.length === 0 && diffResult.changed.length === 0) {
            console.log('✅ 没有发现变化');
          } else {
            console.log(`📊 变化统计:`);
            console.log(`  - 新增: ${diffResult.added.length} 项`);
            console.log(`  - 修改: ${diffResult.changed.length} 项`);
            console.log(`  - 删除: ${diffResult.missing.length} 项`);
            
            if (diffResult.added.length > 0) {
              console.log('\n➕ 新增项:');
              diffResult.added.forEach(key => console.log(`  + ${key}`));
            }
            
            if (diffResult.changed.length > 0) {
              console.log('\n✏️ 修改项:');
              diffResult.changed.forEach(key => console.log(`  ~ ${key}`));
            }
            
            if (diffResult.missing.length > 0) {
              console.log('\n➖ 删除项:');
              diffResult.missing.forEach(key => console.log(`  - ${key}`));
            }
          }
          console.log('==================');
          
          // 检查是否有被删除的字段，如果有则同步删除其他语言文件中的相应字段
          if (diffResult.missing.length > 0) {
            console.log('\n🗑️  检测到删除的字段，正在同步删除其他语言文件中的相应字段...');
            deletedFields = diffResult.missing.map(key => ({
              key,
              path: [key]
            }));
            
            if (deletedFields.length > 0) {
              console.log(`发现 ${deletedFields.length} 个被删除的字段:`);
              deletedFields.forEach(field => {
                console.log(`  - ${field.key}`);
              });
              
              const deleteResult = syncDeleteFieldsFromAllLanguages(languageFiles, deletedFields);
              
              if (deleteResult.success) {
                console.log('✅ 成功同步删除所有语言文件中的相应字段');
                
                // 同时从 en_old.json 中删除这些字段
                console.log('🔄 更新备份文件，移除已删除的字段...');
                let backupData = readJsonFile(oldEnFilePath);
                
                let deletedCount = 0;
                for (const field of deletedFields) {
                  if (deleteFieldByPath(backupData, field.path)) {
                    deletedCount++;
                  }
                }
                
                if (deletedCount > 0) {
                  saveJsonFile(oldEnFilePath, backupData);
                  console.log(`✅ 已从备份文件中移除 ${deletedCount} 个字段`);
                }
              } else {
                console.log('⚠️  部分字段删除失败:');
                deleteResult.results.forEach(result => {
                  if (!result.success) {
                    console.log(`  - ${result.language}: ${result.field}`);
                  }
                });
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
            console.log('\n🎯 检测到 en_old.json 为空且 en.json 有内容，将触发翻译');
            shouldTranslate = true;
          } else if ((diffResult.added.length > 0 || diffResult.changed.length > 0)) {
            console.log('\n🔄 检测到变化，准备增量翻译');
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
                console.log('\n🎯 检测到 en.json 内容比 en_old.json 多，将触发增量翻译');
                shouldTranslate = true;
              } else {
                console.log('\n✅ 没有检测到需要翻译的内容');
                process.exit(0);
              }
            } catch (error) {
              console.log('\n⚠️  无法分析文件内容，跳过翻译');
              process.exit(0);
            }
          } else {
            console.log('\n✅ 没有检测到需要翻译的内容');
            process.exit(0);
          }
        }
        
        if (shouldTranslate) {
          // 3. 执行翻译
          console.log('\n🌍 第二步：执行翻译');
          
          const result = await translate({
            force: options.force || false,
            dryRun: options.dryRun || false
          });
          
          printTranslateSummary(result);
          
          if (result.success) {
            // 4. 备份当前状态
            console.log('\n💾 第三步：备份当前状态');
            // 先备份当前文件
            const backupSuccess = backupFile(enFile.path, oldEnFilePath);
            
            // 如果有被删除的字段，也需要从备份文件中删除
            if (deletedFields.length > 0) {
              console.log('🔄 更新备份文件，移除已删除的字段...');
              let backupData = readJsonFile(oldEnFilePath);
              
              let deletedCount = 0;
              for (const field of deletedFields) {
                if (deleteFieldByPath(backupData, field.path)) {
                  deletedCount++;
                }
              }
              
              if (deletedCount > 0) {
                saveJsonFile(oldEnFilePath, backupData);
                console.log(`✅ 已从备份文件中移除 ${deletedCount} 个字段`);
              }
            }
            
            if (backupSuccess) {
              console.log('✅ 已备份当前状态，下次将进行增量翻译');
            } else {
              console.log('⚠️  备份失败，但不影响翻译结果');
            }
            
            console.log('\n🎉 一键翻译完成！');
            console.log('💡 下次运行将自动进行增量翻译');
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