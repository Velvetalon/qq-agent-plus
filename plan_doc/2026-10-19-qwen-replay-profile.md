# 用户指定 Qwen 聊天/Embedding 的回放配置

日期：2026-10-19，Asia/Hong_Kong。由主协调者亲自审阅既有 bounded-chat-transport、social-chat-replay、embedding-replay、llm thinking配置及真实验收记录后确定。

## 用户要求与授权边界

- 供应商：NanoGPT。
- 聊天（测试及后续上线）：`qwen/qwen3.8-27b-uncensored:thinking`。
- Embedding（测试及后续上线）：`Qwen/Qwen3-Embedding-4B`，2560维。
- 用户提供的密钥仅用于真实合成fixture测试的进程认证。不在任何仓库文件、进度说明、QQ持久配置或证据中写入秘密。
- 模型选择不等同于恢复 SC8；本轮不连接生产服务器、不真实QQ发送、不部署、不解除禁言。

## 实现方案

1. 更新live-only聊天白名单常量为用户给定的精确模型，保持单一固定聊天endpoint和无fallback/无自动外连重试。历史DeepSeek验收文档不倒改。
2. 回放显式使用 `api.thinking='on'`，避免项目普通聊天默认的thinking-off字段与用户指定的`:thinking`配置冲突。不修改已有安装或全局运行默认值。
3. 增加小型live-only凭据读取helper：允许进程环境 `QQ_REPLAY_API_KEY` 或原有 `QQ_REPLAY_KEY_FILE`，两者互斥；缺失、空白或多值拒绝且错误信息不包含秘密。两个live入口共用helper，读入后从进程环境同时移除 `QQ_REPLAY_API_KEY` 和 `QQ_REPLAY_KEY_FILE`，只清除环境变量，不删除原凭据文件。代码不创建凭据文件。
4. 文档明确测试和未来部署使用同一模型组合、thinking配置、旧配置不可作为当前结果。保留真实输出与审计在仓库外，不把运行成功/零发送当语义PASS。
5. 真实 Embedding 首次试运行暴露既有无代理分支缺陷：向 Node fetch 无条件传入 `dispatcher:null`，在任何 HTTP 回应之前以 `assert(dispatcher)` 失败。由主协调者确定修复：仅在有实际 ProxyAgent 时加入 dispatcher，不改变系统代理或目标 endpoint；用一个live-only纯helper统一三处fetch options，补无代理/有代理离线断言。原始失败保留，修复后使用新的独立证据目录重新运行，不将本地失败当 provider 故障或自动重试真实写入。

## 验收与执行上限

- 离线单元验证精确模型锁定、其他模型/endpoint拒绝、凭据输入互斥/格式/不泄漏及现有token/call/failure-latch边界。
- 先运行一次canary：最多6次chat dispatch、100000reported/reserved tokens、每次最多2048输出tokens、60秒超时；失败后停止，不改模型重试。
- Canary成功后才运行本轮选定的 identity/正常短回复/记忆等小样本；每个后续进程仍遵守现有100call/800000tokens/30分钟最大边界，实际选择场景不自动扩成全量。Embedding最多32次、50000合成输入字符、10分钟，失败锁闭。
- 模型的`:thinking`与工具、视觉支持及768 token审核预算须以真实返回为准；若不兼容则记录实际失败，不关闭审核、不替换模型、不降低测试断言。任何需要改动产品预算/协议的决定由主协调者另行确定计划。
- 附带文字修复的既定离线复核与全量门禁仍需完成。真实语义结果分为实际可接受输出、自然沉默、审核拒绝/无可接受输出、调用或预算失败；不能以全部拒绝证明拟人成功。

主协调者是这些模型回放文件及文档的唯一写入者。执行者仅可在范围明确的已实现代码上进行独立复核，不设计模型路线或决定下一项任务。
