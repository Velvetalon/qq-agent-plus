# QQAgent 云环境代码交付计划（2026-10-19）

## 最新授权与交付目标

用户要求整理并提交当前未推送成果，包含未完成实现；不再以真人测试或项目未全卡闭环阻止交付。
目标仅为 `Velvetalon/qq-agent-plus` 的 `fix/deploy-notebook-gate-20261016`。
此前 [语义发送审核计划](2026-10-19-semantic-send-review.md) 的真实模型试验与暂缓推送描述
保留为历史。本轮授权提交、推送当前代码，不新增真实模型/API 试验授权。

## 执行顺序

1. 通过 Library 官方路径取得交接 ZIP；核验大小、SHA256、内部校验和和 Git bundle。
2. 在独立 QQAgent checkout 中，从远端 `dc012094febc8521b5253592c854f7b0910db0b3`
   恢复原提交 `b31c24cb5dfa808cf23e50ccf15264dae4ba8c1b`、
   `54bf28d9311e592ad09b552ca379baec2606580e`，保留全部父历史。
3. 原样恢复 24 个 tracked 修改与 4 个 untracked 新文件；比较 manifest Git 状态、
   完整 binary diff 和新文件字节，复核所有待交付增量中的秘密与禁止路径。
4. 用临时数据目录、清理后的测试环境、非本地网络连接拦截及合成 provider/OneBot
   边界运行静态检查、全量单测、本地回归、UI 回归、sqlite-vec 和实际 Chromium。
5. 提交当前 WIP；在 `/delay` 记录源码提交、实际命令/退出码、结果及未完成项。
   将旧的 800 PASS 和真实模型小样本结论明确标为历史。
6. 普通 fast-forward push 到原分支，回读远端 SHA 与文件树；不强推、不删除历史。

## 边界与验收口径

- 不修改 AlnaslEngine、AACS 或原有 QQAgent `work` checkout。
- 不合并 main、不部署、不创建 tag/Release、不发送真实 QQ、不取用或保存真实凭据。
- 不运行 `test/live/` 的真实模型回放入口；同名 transport 单测使用注入的合成 fetch。
- 保留图片细节幻觉、身份表达误拦及 A-B07/A-R06/A-B10 的已知反例/开放状态；
  本地 mock/离线通过不能充当真实模型最终回归或生产验收。
- 上一开发对话因 preview 用量限制中止；本次只是受支持云环境中的代码交付，
  不尝试恢复或绕过原会话额度。

实际结果和接手清单见 [云交付记录](../delay/schedule/2026-10-19-cloud-handoff-delivery.md)。
