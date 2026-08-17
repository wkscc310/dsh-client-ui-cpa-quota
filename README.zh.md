# dsh-client-ui-cpa-quota

[![GitHub](https://img.shields.io/badge/GitHub-wkscc310%2Fdsh--client--ui--cpa--quota-181717?logo=github)](https://github.com/wkscc310/dsh-client-ui-cpa-quota) [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | 中文

为 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai) Web UI 提供 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 额度指示器：在模型按钮左侧显示与 DSH 上下文圆环一致的 14px 原生风格圆环，悬停后查看当前模型匹配的账号、厂商、套餐、额度窗口和刷新时间。

## 展示

### 模型额度悬浮卡片

<p align="center">
  <img src="assets/screenshots/quota-tooltip.png" alt="模型额度悬浮卡片" width="900">
</p>

### 插件设置卡片

<p align="center">
  <img src="assets/screenshots/settings-card.png" alt="CliProxyAPI 额度插件设置" width="720">
</p>

## 功能

- 自动读取 DSH 每个 LLM 提供方的模型和 `baseURL`，不维护模型列表。
- 自动识别哪些 `baseURL` 是 CLIProxyAPI；普通 OpenAI 兼容地址不会显示空圆环。
- 支持多个 CLIProxyAPI 实例和多个账号，并按当前选择的模型过滤额度。
- 窗口按 `5 小时 → 每周 → 每月 → 每日` 排序；圆环优先使用第一个可用窗口。
- 支持 Codex、Claude、Antigravity、Gemini CLI、Kimi、xAI/Grok；其它 CPA 厂商至少显示账号状态和近期请求活动。
- 刷新失败时保留上一次成功数据；DSH 切屏重挂载模型按钮时复用圆环，避免闪烁。
- 颜色含义：绿色 ≥20% 剩余，黄色 <20%，红色已耗尽/错误，灰色加载中或未配置密钥。

## 环境要求

- DSH **Web profile**（插件只注册 Web UI）。
- 可访问且启用了管理 API 的 CLIProxyAPI 实例。
- 每个要显示额度的模型，必须通过 DSH 提供方配置指向对应 CPA `baseURL`。
- 每个 CPA 实例的 management key。通过设置卡片输入的密钥只保存在当前浏览器的 `localStorage`；使用 YAML 时则由 YAML 文件管理。

## 快速安装

安装脚本会把插件放入 `~/.dsh/plugins`，链接或复制到 Web profile 的 `node_modules`，并自动追加 loader 配置。

### Windows PowerShell

```powershell
$p=Join-Path $env:TEMP 'dsh-cpa-install.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/wkscc310/dsh-client-ui-cpa-quota/main/install.ps1' -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

### macOS / Linux

```sh
curl -fsSL https://raw.githubusercontent.com/wkscc310/dsh-client-ui-cpa-quota/main/install.sh -o /tmp/dsh-cpa-install.sh && sh /tmp/dsh-cpa-install.sh
```

安装完成后重启 DSH Web 宿主，打开：

```text
设置 → 插件 → CliProxyAPI 额度
```

填入每个实例的 management key，然后重新打开模型选择器即可看到圆环。

> Windows 没有创建符号链接的权限时，安装脚本会自动复制插件；复制模式下更新插件后请重新运行安装命令。

## 手动安装

### macOS / Linux

```sh
git clone https://github.com/wkscc310/dsh-client-ui-cpa-quota.git "$HOME/.dsh/plugins/dsh-client-ui-cpa-quota"
mkdir -p "$HOME/.dsh/profiles/node_modules"
ln -s "$HOME/.dsh/plugins/dsh-client-ui-cpa-quota" "$HOME/.dsh/profiles/node_modules/dsh-client-ui-cpa-quota"
```

### Windows PowerShell

```powershell
git clone https://github.com/wkscc310/dsh-client-ui-cpa-quota.git "$env:USERPROFILE\.dsh\plugins\dsh-client-ui-cpa-quota"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\profiles\node_modules" | Out-Null
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-client-ui-cpa-quota" -Target "$env:USERPROFILE\.dsh\plugins\dsh-client-ui-cpa-quota"
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml`（Windows 为 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`）加入：

```yaml
- insert:
    - id: ui-cpa-quota
      name: dsh-client-ui-cpa-quota
```

## 可选配置

自动发现通常已经足够。如需固定实例或使用 YAML 传入管理密钥：

```yaml
- insert:
    - id: ui-cpa-quota
      name: dsh-client-ui-cpa-quota
      config:
        refreshMinutes: 5
        instances:
          - baseURL: https://your-cpa.example
            managementKey: your-management-key
          - baseURL: https://another-cpa.example/v1
            managementKey: another-management-key
```

浏览器设置卡片的配置优先于 YAML。`refreshMinutes` 最小为 1 分钟；管理密钥不建议提交到公开仓库。

## 支持的额度来源

| 厂商 | 上游额度来源 | 常见窗口 |
| --- | --- | --- |
| Codex / OpenAI | `wham/usage` | 5 小时、每周或月度 |
| Claude | OAuth usage/profile | 每周、月度 |
| Antigravity | `retrieveUserQuotaSummary`，回退 `fetchAvailableModels` | 5 小时、每周、每月 |
| Gemini CLI | Google quota endpoint | 5 小时、每周、每日 |
| Kimi | `/coding/v1/usages` | 按接口返回 |
| xAI / Grok | billing；付费账号带健康检查回退 | 每周、月度 |
| 其它 CPA 厂商 | auth-file 状态和近期请求 | 取决于 CPA 返回数据 |

## 自动检测原理

1. 插件从 DSH 的 `llm.providers` 和 `settings.describe` 建立“模型 → baseURL”索引，并统一去掉协议、`www.` 和末尾 `/v1`。
2. 对每个地址请求 `<baseURL>/v0/management/usage-statistics-enabled`。
3. 返回带 `management`/`unauthorized` 的 401，或有效管理接口响应时判定为 CPA；普通服务常见的 404、其它响应或网络失败不会加入额度实例。
4. 探测结果缓存在浏览器一小时。只有确认是 CPA 的地址才创建额度圆环；确认后才使用 management key 请求 `/v0/management/auth-files` 和上游额度接口。

因此，使用普通 OpenAI 兼容 baseURL 的模型不会出现空圆环。自动发现的 CPA 如果尚未填 management key，会显示灰色圆环并提示在设置卡片中配置密钥。

## 排查

- **没有圆环**：确认当前模型的 DSH provider `baseURL` 指向 CLIProxyAPI，而不是上游官方 API；确认管理 API 已启用。
- **灰色圆环**：在“设置 → 插件 → CliProxyAPI 额度”中填写对应实例的 management key。
- **看到旧的模型/实例**：重启 DSH Web 宿主，或在设置卡片点击刷新；探测缓存最多保留一小时。
- **复制安装后更新不生效**：重新运行安装命令，或删除 `~/.dsh/profiles/node_modules/dsh-client-ui-cpa-quota` 后重新安装。

## 开发

本项目是纯 JavaScript，无构建步骤。修改 `lib/client.js` 后运行：

```sh
node --check lib/client.js
node tests/smoke.mjs
git diff --check
```

欢迎提交 Issue 或 Pull Request：[github.com/wkscc310/dsh-client-ui-cpa-quota](https://github.com/wkscc310/dsh-client-ui-cpa-quota)。

## 许可证

[MIT](LICENSE)
