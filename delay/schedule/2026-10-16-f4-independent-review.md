# F4 独立审查及缺陷修复

## 来源与口径纠正

主对话明确要求独立审查固定源码 `6ae135a9dff17eb309b3ec4989faaa063834e7b2`。
此前 task-card-closure 所称“独立复核”实际是实现者再次检查，现已改为
**实现者自查，不构成独立审查**。旧750项测试结果不因此成为独立审查结论。

本次使用受支持的 collaboration 子代理 **`/root/independent_f4_review`**。
该审查者未参与原实现，仅按 AGENTS、F4 §5、源码/测试差异独立检查；未修改
仓库文件。其临时复现只使用隔离合成数据和可控外部边界，无服务器、真实QQ、
模型/embedding服务、付费调用或凭据访问。实现者负责修复，审查者再次复核并
独立运行测试，角色明确分开。

## 发现与处理

| 发现 | 原固定提交实际证据 | 修复及独立复核结果 |
| --- | --- | --- |
| P1 授权await期间配置撤销，旧查询仍发出 | vector-memory search在authorizeQuery之后没有发送前快照校验；实际NotebookStore+ready索引，授权期间enabled=false，旧client仍调用1次，结果仅事后profile-changed | 请求前和响应后核对profile/client及enabled/allowQuery/allowPrivate/maxDistance/maxQueryChars；独立原复现查询计数变0。永久测试覆盖关闭、撤销query、阈值/输入限制/model变化 |
| P2 反思截断吞掉最新目标 | ReflectionStore→Worker→NotebookStore，5条各240字符旧证据后接CURRENT_TARGET，原slice(0,1200)使实际embedding输入不含目标 | 改保留末尾1200字符；独立临时复现及永久Worker测试均含目标且有界；原prompt和Notebook内容断言保留 |

修复提交：`78dd7683ac4063d2844e810b5c0eb452788b1724`。
关键位置：`src/plugins/self-evolution/vector-memory.js` 的 queryStateChanged/发请求前后检查；
`src/plugins/self-evolution/reflection-worker.js` 的查询构造；永久回归为
`test/notebook-ready-vector.test.mjs` 和 `test/self-evolution-reflection.test.mjs`。

旧测试修改独立审查结论：未发现降低验收标准或隐藏已知回归。旧“关闭embedding
仍词法命中”与既定F4 §5.2冲突，改成零召回负例合理；范围、当前revision、隔离、
预算等正例断言仍保留。旧failed-case目前不触发请求，实际503故障路径已由
真实app跨消费者与ready-vector测试补充，不能单凭旧测试名称当作故障覆盖。
模拟向量只证明管线和约束，不证明中文语义质量。

## 独立执行证据

审查者使用Node **22.22.2**。原固定候选六个重点文件51通过，0失败/跳过，
日志 `/tmp/qq-independent-f4.tap`。该结果未发现竞态，审查者追加复现才暴露问题。

修复候选独立命令：

```sh
node --test test/notebook-ready-vector.test.mjs test/social-vector-app.test.mjs test/self-evolution-retrieval.test.mjs test/self-evolution-retrieval-e2e.test.mjs test/self-evolution-notebook.test.mjs test/self-evolution-reflection.test.mjs test/orchestrator.test.mjs test/functional-repair.test.mjs
```

**93 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，退出码0**；日志
`/tmp/qq-independent-f4-fixed.tap`。审查者核对HEAD确为修复提交，源码与测试无未提交差异。
独立Reflection复现 `/tmp/qq-review-reflection.mjs`，红日志
`/tmp/qq-review-reflection.tap`，绿日志 `/tmp/qq-review-reflection-fixed.tap`。
实现者永久测试红灯：`/tmp/qq-f4-review-race-red.tap`、
`/tmp/qq-f4-review-target-red.tap`；聚焦绿灯 `/tmp/qq-f4-review-fixes.tap`，27/27通过。

独立审查最终结论：两项发现均已验证修复，未发现其他确定阻断项。不是对所有
可能缺陷的保证，也不替代真实模型、QQ或服务器验收。审查者没有声称运行完整
全仓门禁；以下全仓结果由实现者另行运行并注明归属。

## 发布与授权边界

仍为独立草稿PR #1，不合并、不发版、不force push。任务卡既有模型/平台/生产
阻塞及最小解锁条件继续有效。服务器连接、认证、部署和远端替换仍USER_PAUSED；
没有远端操作或不确定结果。所有临时证据可能随环境回收，永久测试和本记录保存在Git。

## 实现者另行执行的完整门禁

固定修复源码 `78dd7683ac4063d2844e810b5c0eb452788b1724`，Node22.22.2：
**750 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**，63.4秒。
本地回归9/9；prompt/render/scroll/usage、sqlite-vec smoke、严格扫描0可疑调用、
254文件node语法、shell语法、git diff检查、真实Chromium全部exit0。
Chromium同时包含reasoning合成标记不泄露回归；0脚本异常、0真实模型请求、
0QQ发送，预期合成模型2次。

命令/退出码/时长及日志：`/tmp/qq-social-final-gates-ektesau5/`；浏览器证据
`/tmp/qq-interest-browser-YDJxza/`。之后仅保存审查文档，不改变已验证源码/测试。
