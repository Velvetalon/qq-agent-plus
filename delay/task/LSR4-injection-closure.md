# LSR4 Learned Self 注入、过期与闭环验收

## 目标

让 Learned Self 注入具备来源、范围、时间和过期边界，支持用户纠正和管理员移除，并完成从 profile 清理到新反思闭环的验收。

## 范围

- 注入 key/value 时同时保留并展示非敏感元数据：scope、source chats、createdAt、lastObservedAt、evidence count、confidence、expiresAt。
- 默认设置有限 TTL；过期 trait 不进入聊天 Prompt，也不参与新的反思输入。
- 注入抽象偏好，不注入完整历史台词、固定图片配方、错误码和调度计划。
- 增加单条 trait 删除、用户纠正/管理员纠正和可审计回滚入口。
- 增加 profile/retrieval/reflection 观测字段：注入条数、过期条数、user evidence 比例、assistant-only 拒绝数、global 晋升数、procedural 拒绝数。
- 用脱敏线上案例回放验证：清理后的 profile 不再污染 Prompt；新合法偏好经过门禁后才进入注入；错误 trait 可撤销。

## 不做

- 不新增第二套人格系统或自动修改 Base Persona。
- 不把完整 evidence 正文塞进每次聊天 Prompt；管理端按既有权限查看即可。
- 不用固定台词命中作为人物行为验收标准。
- 不在本卡默认部署或重新启用线上反思；部署需主任务明确授权。

## 验收

- Learned Self provider 输出包含来源/范围/过期信息，并过滤过期条目。
- profile reset → 新聊天 → 合法 evidence → review/pending → approve → 注入的闭环通过。
- 用户纠正或管理员删除后，下一次 Prompt 不再出现旧 trait；历史和审计仍保留。
- 线上脱敏案例中“人呢”、固定表情、`result=120` 不再注入。
- 运行统计不泄露密钥、完整 QQ 号或未授权跨群正文。
- 生成 `docs/verification/vnext-learned-self-lsr4.md`，记录 focused、集成和 LIVE_NOT_RUN 项。

## 实施自由度

可以选择在 provider 层过滤过期条目，或在 store 查询层过滤；可以用控制台已有 profile 页面扩展纠正入口。必须保持账号/聊天 scope 隔离、CAS 和历史可回滚。

## 交付

注入/过期/纠正实现、完整 focused/integration tests、观测字段、验证文档、部署与回退说明。真实模型行为和生产部署如未执行，明确标记 `LIVE_NOT_RUN`。

