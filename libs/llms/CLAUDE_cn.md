# CLAUDE.md

本文档为 Claude Code（claude.ai/code）在处理本仓库代码时提供指导。

## 项目概述

这是一个通用的大语言模型（LLM）API 转换服务器，作为中间件，用于标准化不同 LLM 提供商（Anthropic、Gemini、Deepseek 等）之间的请求和响应。它采用模块化转换系统来处理特定提供商的 API 格式。

## 核心架构组件

1. **转换器（Transformers）**：每个提供商都有一个专用的转换器类，实现以下方法：
   - `transformRequestIn`：将提供商的请求格式转换为统一格式
   - `transformResponseIn`：将提供商的响应格式转换为统一格式
   - `transformRequestOut`：将统一的请求格式转换为提供商的格式
   - `transformResponseOut`：将统一的响应格式转换回提供商的格式
   - `endPoint`：指定提供商的 API 端点

2. **统一格式**：请求和响应使用 `UnifiedChatRequest` 和 `UnifiedChatResponse` 类型进行标准化。

3. **流式支持**：处理提供商的实时流式响应，将分块数据转换为标准化格式。

## 常用开发命令

- **安装依赖**：`pnpm install` 或 `npm install`
- **开发模式**：`npm run dev`（使用 nodemon + tsx 实现热重载）
- **构建**：`npm run build`（输出到 dist/cjs 和 dist/esm）
- **代码检查**：`npm run lint`（对 src 目录运行 ESLint）
- **启动服务器（CJS）**：`npm start` 或 `node dist/cjs/server.cjs`
- **启动服务器（ESM）**：`npm run start:esm` 或 `node dist/esm/server.mjs`

## 项目结构

- `src/server.ts`：主入口文件
- `src/transformer/`：特定于提供商的转换器实现
- `src/services/`：核心服务（配置、LLM、提供商、转换器）
- `src/types/`：TypeScript 类型定义
- `src/utils/`：工具函数
- `src/api/`：API 路由和中间件

## 路径别名

- `@` 映射到 `src` 目录，使用 `import xxx from '@/xxx'` 导入

## 构建系统

项目使用 esbuild 进行构建，分别输出 CJS 和 ESM 格式。构建脚本位于 `scripts/build.ts`。

## 添加新转换器

1. 在 `src/transformer/` 中创建新的转换器文件
2. 实现所需的转换器方法
3. 在 `src/transformer/index.ts` 中导出该转换器
4. 转换器将在启动时自动注册