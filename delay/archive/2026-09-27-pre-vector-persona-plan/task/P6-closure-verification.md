# P6 闭环验收

> 状态：planned。依赖 P0–P5 全部完成。此卡不新增业务功能，只做跨模块验收与修复闭环。

## 必须覆盖

1. account isolation：account A 写入，account B 读取为空。
2. chat/global isolation：private:A 写入，group:B 搜索为空；同账号其他 chat 只读 global。
3. retrieval e2e：append → restart → 新 Run → user prompt/context block 含正确笔记。
4. irrelevant filtering：无关笔记不进入上下文，预算与命中审计一致。
5. reflection lifecycle：job1 apply → revision=1；job2 apply → revision=2。
6. rollback：apply trait → rollback → 下一次 learned context 移除 trait。
7. archive：归档后不再召回，但历史可审计。
8. disabled mode：停用不建库、不写入、不起 worker、不调用 embedding/reflector；已有数据可读。
9. security：模型不能指定 accountId、跨 chatKey、用 tags 扩权或触碰 Base Persona/security/tools。

## 真实链路

至少一条测试必须进入真实 composition root、PluginManager、SQLite 和模型请求构造；不得只测私有 helper。外部 LLM/OneBot/embedding 只允许 mock 边界，不得使用生产凭据。

## 交付物

- `docs/verification/vnext-self-evolution-closure.md`
- `docs/verification/self-evolution-closure-20260925/`
- 新增测试文件：
  - `test/self-evolution-account.test.mjs`
  - `test/self-evolution-retrieval-e2e.test.mjs`
  - `test/self-evolution-reflection-lifecycle.test.mjs`

## DoD

- [ ] Notebook 写入账号与管理端账号一致
- [ ] chat/global scope 隔离有效
- [ ] 笔记跨 Run 自动召回
- [ ] 无关笔记不进入上下文
- [ ] Learned Self 连续版本更新
- [ ] Reflection 不重复消耗预算
- [ ] Reflection 不修改 Base Persona
- [ ] 归档不再召回
- [ ] 回滚后 prompt 状态正确
- [ ] 所有新增能力都有真实链路测试

## 回退

按模块关闭 self-evolution/retrieval/reflection；保留正文、版本、jobs、gaps、audit；不得删除数据或重试未知外发。

