# 聊天模型统一改用 DeepSeek V4.1 Flash 1017

日期：2026-10-20，Asia/Hong_Kong。基线 `9cfc02cca3af499a59aaa7c944189570279c12c0`。
用户明确要求聊天模型改用 `deepseek/deepseek-v4.1-flash-1017`，测试和线上使用同一模型。供应商仍NanoGPT，Embedding仍为 `Qwen/Qwen3-Embedding-4B` / 2560维。

## 主协调者确认的范围

已亲自核对当前状态、最新交接及src/test的模型引用。src工厂配置的模型刻意留空，已有线上实例的实际配置不在Git中；本轮不把改live常量冒充已改服务器。修改当前测试白名单、精确模型断言、当前测试/后续上线配置说明和delay入口，不倒改Qwen历史实测记录。

- `test/live/bounded-chat-transport.mjs` 精确聊天白名单改为指定DeepSeek；thinking on、2048/45000审核设置、endpoint、调用/token/超时/失败锁闭保持不变，不设Qwen聊天fallback。
- `test/live-replay-profile.test.mjs` 更新精确选择断言；另加原Qwen聊天模型在transport层0dispatch拒绝回归。
- live README同时更新测试入口与未来线上明确配置的聊天模型。Embedding模型/维度及运行启用状态不变；不写秘密或覆盖持久凭据。
- 原SC8/服务器连接与部署暂停不由此次模型选择自动解除。未获恢复前不连接生产、不改现存服务器配置、不重启、不部署、不真实QQ发送。最终需明确区分“仓库约定已统一”和“线上实例已实际切换”。

## 验收

先存档本计划，再改实现、运行profile/transport及相关审核专项。既有模型/endpoint/无fallback/预算边界不放松。常量级配置变更由主协调者实现和核对，不为此委派架构任务。

真实验证使用原合成short-invitation canary，最多6次chat请求、100000 reported/reserved tokens；每次2048输出、60秒/整轮30分钟既有界限不变。失败（包括402）即停止实际请求，不换密钥/模型或自动重试。Canary成功且有正常输出时，可接着仅复验原identity场景（仍受既有100call/800000tokens/30min硬上限）；不扩成全量付费测试，不改原fixture。密钥只进程认证，原始日志/输入/响应在Git外。

完成后记录实际结果/费用及待验收边界，普通commit/push唯一origin，不tag/Release，不宣称整体可上线。
