# CFG-RB01：通用配置失败时精确恢复selfEvolution

状态：OPEN，当前生产配置已恢复成功；本卡不是已完成修复，也不否定91be实际发布结果。

## 主协调者已核对的事实

本轮通用配置POST添加Embedding timeout后，因为缺少宿主selfId在[自我迭代重载](../../src/console/app.js#L2786-L2803)返回500。当前回滚用普通深合并恢复previousSelfEvolution，因此新加的embedding.timeoutMs仍留在磁盘。之后通过可信已有账号配置恢复，当前实际配置符合授权，但通用失败精确回滚仍有缺口。

## 待实施的验收边界

- 由主协调者进一步确定并存档实现方案，再用workflow显式model派发实现/自测，不委派架构/方向。
- 模块失败须恢复该节的精确原值，包括新增嵌套键的删除，以及原属性缺失/null/legacy alias语义；不能简单恢复{}导致遮蔽原legacy设置。
- 保留其他模块既有事务边界，不擅自扩成全配置事务或关闭账号校验；不在生产注入错误。
- 合成临时应用：正常保存、不明selfId导致拒绝、初始canonical对象、原始缺失/null/legacy分支、新嵌套字段不残留、控制台/模型/账号密钥不泄漏等回归。
- 本轮[部署者cleanup测试](../../test/production-embedding-cleanup.test.py)仅覆盖专用API保存/测试异常后的暂停尝试，不能充当本卡产品配置回滚验收。

参见[当前完整结果](../schedule/2026-10-20-workflow-resume.md)。后续实际收到指令时按授权直接处理，不再询问。
