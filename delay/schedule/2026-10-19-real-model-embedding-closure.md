# QQAgent 真实模型与必选 Embedding 收口进度

日期：2026-10-19。精确仓库 `Velvetalon/qq-agent-plus`，工作分支
`fix/deploy-notebook-gate-20261016`。远端接管基线 `dc012094febc8521b5253592c854f7b0910db0b3`，
之前本地验证修复 commit `b31c24cb5dfa808cf23e50ccf15264dae4ba8c1b`。
当前不 push，因为用户要求全部任务卡结束后再提交 GitHub，而 SC8 仍暂停。

## 新范围

用户授权指定 DeepSeek chat 离线真实回放，随后明确 Embedding 必选，要求单独
网关/API key/模型名设置页，使用 NanoGPT Qwen3-Embedding-4B / 2560。
此前“可选 embedding”“真实模型未授权/未运行”是历史时点，不能再作为当前结论。
当前 key 仅临时进程认证；没有创建新的持久 credential，没有生产聊天或 QQ 发送。

## 当前状态

- 模型回放与修复：见 [逐例真实验收](../../docs/verification/real-model-replay-20261019.md)。
- 必选 Embedding 设置页和实际浏览器：见 [独立 UI 验收](../../docs/verification/embedding-settings-20261019.md)。
- 实际 Notebook 写入、真实 4B 索引、新会话召回、无关查询、阈值小样本与 profile 隔离均已实测。
- 17 项真实语义/行为：14 项有本组小样本支持；B07 复读 FAIL，R06/B10 因跨场景编造过去行动保持 PARTIAL / OPEN。
- 最终本地全量 800 PASS；prompt/render138/scroll19/usage31/local9/9/sqlite/strictscan 均过；独立 focused86 PASS。
- 本轮明确停止继续调 prompt/模型调用，不暗改 fixture 或用 mock 关闭上述真实缺口。
- SC0/1/3/4/5/6/7 的本地宿主契约不因模型语义通过而等同真实 QQ 平台完成。
- SC8/历史生产 profile reset 仍 USER_PAUSED；连接、盘点、备份、清理、部署、灰度和回退未跑。

## 交付与停止条件

保留真实失败和中间轮次，不 mock 成 PASS；模型语义仅这组小样本，不能承诺泛化质量。
没有合并 main、部署、push 或开启 CI。当前远端仍原基线，不把没有 CI 当作 CI 成功。
工作进度先在本地 `/delay` 归档和 commit。后续如要发布未完成快照，需明确改变原发布
条件；如要生产动作，需用户恢复暂停并按具体操作授权。真实 QQ 账号/协议行为另行验收。
