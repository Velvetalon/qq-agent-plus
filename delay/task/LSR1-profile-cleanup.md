# LSR1 Learned Self 当前 Profile 清理

## 目标

在不删除历史的前提下清理当前 Learned Self profile，移除已确认的固定台词、固定表情、调度规则和发送错误规则，为后续修复后的重新学习建立干净起点。

## 范围

- 增加只读审计/预览能力，列出当前 global/chat profile、trait 值、来源 revision、证据引用、创建时间和作用域。
- 增加非破坏性 reset 或按条目清理能力：以新 profile revision 记录空 profile/清理结果，保留旧版本、proposal、evidence、audit。
- 默认清理本次审计确认的 procedural/script traits；若实现无法可靠区分抽象偏好与脚本，采用“隔离当前 profile、从空 profile 重建”的方案，不直接删除历史。
- 提供回滚到清理前 revision 的管理入口或等价运维命令，要求 CAS/当前 revision 校验。

## 不做

- 不直接删除 SQLite 行，不重写历史版本。
- 不清理普通 Notebook 正文，除非条目明确是 Learned Self 反思写入的运行脚本，并能在预览中逐条确认。
- 不修改反思证据规则；该工作由 LSR2/LSR3 负责。
- 不执行生产迁移或部署，除非主任务另行授权。

## 验收

- 测试库中执行清理后，当前 profile 不再包含“人呢”、固定表情配方、`result=120`、schedule/retry/queue 等 procedural 值。
- 清理前 revision、目标 revision、操作者、原因和条目差异可查询。
- 清理后可以回滚到清理前 profile；回滚使用当前 revision/CAS，不覆盖并发新版本。
- 既有 profile 查询、历史列表和账号/聊天隔离测试继续通过。
- 生成 `docs/verification/vnext-learned-self-lsr1.md`，记录命令、退出码、清理条数、保留条数、PASS/FAIL/NOT_RUN。

## 实施自由度

可以选择控制台操作、受保护运维命令或两者并存；可以选择“逐条清理”或“新建空 profile revision”，但必须保留历史和可回滚性。不得通过硬编码某几个 revision 绕过 profile 语义。

## 交付

代码、focused tests、脱敏审计/迁移工具、验证文档。线上只提交 dry-run 结果，正式迁移等待主任务授权。

