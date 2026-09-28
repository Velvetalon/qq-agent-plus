# PR1 配置、鉴权与外发授权

## 目标

修复 embedding 客户端使用脱敏 `[redacted]`、配置热更新不换实例、授权方法未约束真实 HTTP 的问题；不改变插件框架。

## 范围

- `createApp -> PluginManager -> self-evolution` 正式装配路径创建私有 embedding facade。
- 插件只获得受限 encode/query 能力，不获得原始 key、任意 endpoint/header、完整配置或任意 HTTP。
- 统一 `allowQuery`/`allowPrivate` 显式 false 语义；正文可保存但被禁止外发时返回明确 `external-disallowed`。
- 配置变化绑定不可变 client/profile/generation 快照；旧请求晚到不得写入新 profile。

## 不做

不做后台索引、查询路径重写、反思预算、角色提示词或控制台大改；不使用 fake client 替代正式装配验收。

## 验收

- 真实装配的假 HTTP 服务收到测试 key，仓库日志、插件配置和 LLM 输入无 secret。
- 显式禁止外发时 document/query HTTP 均为 0，且原因不是 no-matches。
- 补填/轮换 key、模型或维度后的新 Run 使用新快照；旧返回不能污染新 profile。
- 只运行局部 focused tests 和对应 P0/P1/P2 回归，不因基线失败放宽边界。

## 交付

代码、focused tests、`docs/verification/vnext-functional-repair-pr1.md`；未完成项如实记录。
