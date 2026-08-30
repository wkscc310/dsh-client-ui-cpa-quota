# dsh-client-ui-cpa-quota

[![GitHub](https://img.shields.io/badge/GitHub-wkscc310%2Fdsh--client--ui--cpa--quota-181717?logo=github)](https://github.com/wkscc310/dsh-client-ui-cpa-quota)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/wkscc310/dsh-client-ui-cpa-quota/actions/workflows/ci.yml/badge.svg)](https://github.com/wkscc310/dsh-client-ui-cpa-quota/actions/workflows/ci.yml)
[![dsh](https://img.shields.io/badge/dsh-0.1.1--rc.x-29abe2)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

一个 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/deepseek-harness) Web UI 插件，把 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的额度放到你一定会看的地方：模型选择器旁的原生风格圆环、设置卡片上的健康度圆点，以及一块仿 CPA 管理页的「全部账号额度」面板。

- 零依赖、纯 JavaScript、无构建步骤。
- 从 DSH 提供方的 `baseURL` 自动发现实例——不需要维护模型列表，也不需要配置文件。
- 全部逻辑跑在浏览器端；管理密钥只保存在当前浏览器的 `localStorage`。

## 展示

### 折叠卡片 + 额度健康度圆点

设置卡片默认折叠，与官方插件卡片一致。圆点浓缩了所有实例最紧张的额度窗口：绿色健康、黄色有窗口低于 20%、红色已耗尽或刷新失败、灰色等待中/未配置密钥。

<p align="center">
  <img src="assets/screenshots/settings-card-collapsed.png" alt="折叠态 CliProxyAPI 额度卡片与健康度圆点" width="900">
</p>

### 全部账号额度，仿 CPA 管理页

展开后列出每个实例的每一个账号：订阅套餐、厂商徽章、全部额度窗口（5 小时 / 每周 / 每月），不按当前模型过滤。（截图数据来自 `tests/mock-cpa.mjs`。）

<p align="center">
  <img src="assets/screenshots/settings-card-accounts.png" alt="全部账号额度面板" width="900">
</p>

### 模型选择器旁的圆环

悬停当前模型左侧的圆环，查看匹配的账号、厂商、套餐、额度窗口和刷新时间。

<p align="center">
  <img src="assets/screenshots/quota-tooltip.png" alt="模型额度悬浮卡片" width="900">
</p>

## 功能

- 自动读取 DSH 每个 LLM 提供方的模型和 `baseURL`，不维护模型列表。
- 自动识别哪些 `baseURL` 是 CLIProxyAPI；普通 OpenAI 兼容地址不会显示空圆环。
- 支持多个 CLIProxyAPI 实例和多个账号：悬浮卡片按当前模型过滤，设置面板始终展示全部。
- 窗口按 `5 小时 → 每周 → 每月 → 每日` 排序；圆环优先使用第一个可用窗口。
- 支持 Codex、Claude、Antigravity、Gemini CLI、Kimi、xAI/Grok；其它 CPA 厂商至少显示账号状态和近期请求活动。
- 账号探测走有界并发池并带单请求超时——一个挂起的上游绝不会卡住整个刷新周期。
- 刷新失败时保留上一次成功数据；DSH 切屏重挂载模型按钮时复用圆环，避免闪烁。
- 颜色含义：绿色 ≥20% 剩余，黄色 <20%，红色已耗尽/错误，灰色加载中或未配置密钥。

## 环境要求

- 采用新版插件契约的 DSH **Web profile**（已在 `dsh` 0.1.1-rc.2 上验证；插件只注册 Web UI）。
- 可访问且启用了管理 API 的 CLIProxyAPI 实例。
- 每个要显示额度的模型，必须通过 DSH 提供方配置指向对应 CPA `baseURL`。
- 每个 CPA 实例的 management key。通过设置卡片输入的密钥只保存在当前浏览器的 `localStorage`；使用 YAML 时则由 YAML 文件管理。

## 快速安装

安装脚本会把插件放入 `~/.dsh/plugins`，通过 `dsh plugin --profile web add` 装入 Web profile（不可用时回退为复制到 profile 的 `node_modules`），并在 profile 的 `cordis.patch.yml` 中注册 loader 条目。

### Windows PowerShell

```powershell
$p=Join-Path $env:TEMP 'dsh-cpa-install.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/wkscc310/dsh-client-ui-cpa-quota/main/install.ps1' -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

### macOS / Linux

```sh
curl -fsSL https://raw.githubusercontent.com/wkscc310/dsh-client-ui-cpa-quota/main/install.sh -o /tmp/dsh-cpa-install.sh && sh /tmp/dsh-cpa-install.sh
```

重启 DSH Web 宿主，打开：

```text
设置 → 插件 → CliProxyAPI 额度
```

展开卡片，填入每个实例的 management key，然后重新打开模型选择器即可看到圆环。

> 插件以「普通依赖 + loader 条目」方式安装（它是 UI 插件，不是 `dsh.bundle`），因此 `dsh plugin add` 时的 `declares no dsh.bundle` 警告属正常现象。更新插件后请重新运行安装命令。

## 手动安装

### macOS / Linux

```sh
git clone https://github.com/wkscc310/dsh-client-ui-cpa-quota.git "$HOME/.dsh/plugins/dsh-client-ui-cpa-quota"
dsh plugin --profile web add "$HOME/.dsh/plugins/dsh-client-ui-cpa-quota"
```

### Windows PowerShell

```powershell
git clone https://github.com/wkscc310/dsh-client-ui-cpa-quota.git "$env:USERPROFILE\.dsh\plugins\dsh-client-ui-cpa-quota"
dsh plugin --profile web add "$env:USERPROFILE\.dsh\plugins\dsh-client-ui-cpa-quota"
```

没有 `dsh` CLI（或没有 pnpm）时，改为把插件复制进 profile 的 `node_modules` —— 不要用符号链接：Node 会从链接目标的真实路径解析依赖，插件自身的 import 会解析失败：

```sh
mkdir -p "$HOME/.dsh/profiles/web/node_modules"
cp -R "$HOME/.dsh/plugins/dsh-client-ui-cpa-quota" "$HOME/.dsh/profiles/web/node_modules/"
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml`（Windows 为 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`）加入 loader 条目。如果文件还是全新 profile 的占位 `[]`，请将其替换为：

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

1. 插件从 DSH 的 `llm.providers` 和 `settings.describe` 建立「模型 → baseURL」索引，并统一去掉协议、`www.` 和末尾 `/v1`。
2. 对每个地址请求 `<baseURL>/v0/management/usage-statistics-enabled`。
3. 返回带 `management`/`unauthorized` 的 401，或具备 CPA 特征的 2xx 时判定为 CPA；普通服务常见的 404、其它响应或网络失败不会加入额度实例。
4. 探测结果缓存在浏览器一小时；**立即刷新**会立刻重新探测所有地址——新加的 CPA 实例无需等待缓存过期。

因此，使用普通 OpenAI 兼容 baseURL 的模型不会出现空圆环。自动发现的 CPA 如果尚未填 management key，会显示灰色圆环并在设置卡片中提示。

## 开发

纯 JavaScript，无构建步骤。

```sh
node --check lib/client.js && node --check lib/index.js
node tests/smoke.mjs        # 完整逻辑 + 设置卡片渲染测试
node tests/mock-cpa.mjs     # 可选：在 http://127.0.0.1:8317 起一个假 CPA（密钥 mock-key）
```

在插件卡片里手动添加该 mock 地址，无需真实 CPA 即可体验完整的五账号演示。CI 会在 Ubuntu 和 Windows 上对每次 push / PR 运行语法检查与冒烟测试。

## 常见问题

- **没有圆环？** 当前模型的 DSH 提供方 `baseURL` 必须指向 CLIProxyAPI 而非上游官方 API，且管理 API 已启用。圆环跟模型走——切换模型即可。
- **灰色圆环？** 在「设置 → 插件 → CliProxyAPI 额度」中填入该实例的 management key。
- **刚加了 CPA 实例但没反应？** 点卡片里的「立即刷新」——它会立刻重新探测所有地址，不必等一小时的探测缓存。
- **数字不新鲜？** 按设定间隔自动刷新；刷新失败会保留上次成功数据并在卡片上说明。
- **密钥存在哪？** 只存当前浏览器的 `localStorage`。额度请求由浏览器直达各实例，DSH 宿主完全接触不到你的密钥。

## 许可证

[MIT](LICENSE)
