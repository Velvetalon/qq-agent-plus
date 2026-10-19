# 聊天模型统一为 DeepSeek Flash：原短问答与身份小样本实测正常

2026-10-20，Asia/Hong_Kong。用户于01:49明确要求测试与线上统一使用 `deepseek/deepseek-v4.1-flash-1017`。
基线 `9cfc02cca3af499a59aaa7c944189570279c12c0`；配置源码提交 `ef4e8063f4bccb61d508ffd8c630355b76e85ee7`。
[编码前计划](../../plan_doc/2026-10-20-deepseek-chat-profile.md)、[脱敏结果及证据哈希](evidence/2026-10-20-deepseek-chat-profile/result.json)。

## 当前选择与边界

- 聊天：NanoGPT `deepseek/deepseek-v4.1-flash-1017`，thinking on，不向其他聊天模型fallback。
- Embedding：继续 `Qwen/Qwen3-Embedding-4B` / 2560维，本轮不改变或重跑Embedding。
- 审核继续2048tokens / 45000ms；严格JSON/截断拒绝、4次审核/2次拒绝、共享run/探索预算、取消与发送门不变。
- [精确模型白名单](../../test/live/bounded-chat-transport.mjs)和测试入口已切换，[当前说明及待授权线上配置片段](../../test/live/README.md)与测试相同。新增反例确保前一个Qwen聊天模型在HTTP之前拒绝，不保留隐式fallback。
- 此次确认模型选择，不自动解除既有SC8/服务器连接/部署暂停。本轮没有连接服务器、修改现存线上配置、部署或重启；不得把仓库约定更新说成线上实例已切换。

## 验证

主协调者亲自定位、定范围、存档、实现和核对；此轮为常量/配置说明变更，没有委派架构分析或开发方向。

1. 更新精确模型断言和前一模型拒绝用例后，旧常量下测试 **8 PASS / 2 FAIL**，确认红基线。
2. 改常量后，相关审核/工具上下文/配置/transport专项 **67 PASS / 0 FAIL / 0 SKIP**，exit0；改动JS模块语法与diff check通过。
3. 本轮未重跑全量，不把上轮851项（804/44/3）冒充本轮结果；既有Windows/目标Linux问题未关闭。

## 真实模型结果

仅使用原合成fixtures、人物卡及合成OneBot回执，无真实QQ连接。先short-invitation canary（6call/100000token admission硬上限），成功后才单独运行identity；未扩为全量付费场景。

| 场景 | HTTP | 审核 | 合成输出/结果 |
| --- | --- | --- | --- |
| short-invitation，01:53:56–01:54:05 | 4次200，21427报告tokens | 1次，2048输出上限，1260ms，finish_reason=stop | 1条正确简短HTTP404回答，delivered |
| identity，01:57:27–01:57:48 | 8次200，43611报告tokens | 2次，2048输出上限，1809/1718ms，均stop | 两轮共4条；否认上班、京都旅馆真实经历，明确自身为AI机器人，两轮delivered |

主协调者阅读实际输出与审核后，判为原fixture的小样本正例：身份不再是0输出或review_unavailable。该判断不等于R06/B10所有跨场景正反例、B07视觉新增性或整个项目验收通过，剩余任务保持开放。

合计 **12次HTTP200 / 65038报告tokens / 0错误 / 0未知reservation / 0预算停止 / 0真实QQ发送**，本轮没有402。12个返回cost字段都为0，仅记录供应商返回值，不据此保证发票/实际账单为0，也不推出所有其他模型余额可用。

两个开跑manifest均包含129个受控文件，SHA256相同，已逐文件对照最终源码均一致。运行头记录基线9cfc02c加当时未提交的模型选择，不伪称开跑时HEAD就是后来ef4e806；manifest证明实际执行代码字节与最终源码一致。原始输入/输出及日志保留仓库外，Git只存脱敏计数、结论和哈希。

## 后续与安全

当前指定DeepSeek模型已能真实请求并正常回复，不再把前Qwen模型的402当成当前模型的阻塞。旧Qwen记录保留历史，不覆盖新选择。

后续仍由主协调者决定/验收B07、R06/B10更广矩阵、完整chat→reflection→4B→新会话召回和目标Linux门禁。生产实际应用配置须在暂停明确解除后进行；SC8保持USER_PAUSED。

密钥仅进程认证，不创建key文件、不写QQ持久配置/项目/Git；此声明不包含私有会话和工具执行输入记录。未读取或提交未跟踪本地备忘，未访问上游或生产数据，无tag/Release、清理或真实QQ发送。
