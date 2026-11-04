# dsh-provider-variants

DeepSeek Harness（DSH）插件：给同一个上游提供商配第二把 API 密钥。每条 pi-ai 提供商卡片多一个「添加另一个密钥」，一键复制出端点、模型目录、兼容选项完全相同，但路由与凭据独立的条目（Provider ID 是路由、设置与凭据共用的主键，不能重复）。

> A DeepSeek Harness plugin that adds an "Add another key" action to every pi-ai provider card, cloning the same upstream under a new provider route with its own API key.

## 用法

1. 设置 → 模型 → 任意 pi-ai 提供商卡片 →「添加另一个密钥」
2. Provider ID 预填 `<源 ID>-<n>` 并自动跳过已占用位，显示名称预填 `<源名称> (n)`，填入新密钥
3. 创建后设置页出现新行，`/model` 出现新分组，凭据保存为 `<新 ID>_API_KEY`

显示名称可改成与源条目相同，两个分组看起来就完全一致——名称不参与唯一性判定。

## 安装

要求 DSH `>= 0.2.1-rc.2`（Web GUI）。

- 会话内：让 Agent 执行插件管理器的 `install_bundle`，target 填 `dsh-provider-variants`
- GUI：插件管理 → 安装 bundle → 输入 `dsh-provider-variants`（或 `dsh-provider-variants@latest`）
- CLI：`dsh plugin --profile web add dsh-provider-variants`（装完重启 `dsh`）

安装后刷新页面，设置 → 模型即可看到按钮。

> 若此前用 `link:` 装过本地开发副本，请先移除再安装本包——两者使用相同的插件行 id 与插槽 key，不能同时启用。

## 更新 / 卸载

```bash
dsh plugin --profile web update dsh-provider-variants   # 或 add dsh-provider-variants@latest
dsh plugin --profile web remove dsh-provider-variants
```

GUI 或会话内：插件管理器移除后重装最新版。

## 限制

- 仅对 pi-ai 适配器的提供商生效（`llm-pi-ai` 设置段）；该行改名需改 `client.js` 的 `SETTINGS_NS`
- 密钥必填，不处理克隆后另行 OAuth 登录
- 凭据引用固定派生 `<ID>_API_KEY`，同引用已存在时会被覆盖
- 整份模型目录一并复制；只克隆设置层里已有的 profile

## 开发与测试

```bash
npm test                          # 纯函数、注册、渲染冒烟
node .scratch/schema-check.mjs    # 克隆结果过真实 pi-ai Config
```

## License

MIT