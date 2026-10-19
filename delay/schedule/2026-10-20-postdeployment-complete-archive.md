# 上线后完整再归档

2026-10-20，Asia/Hong_Kong。按用户再次要求，整合代码、全部工作进度、实际上线/备份/恢复、验证与未完成范围。本轮只读核验，不新增部署、模型请求或索引，不改变隐私开关。

## 统一入口

- [此前全部开发提交链与历史实测](2026-10-20-complete-work-archive.md)：face/CQ、thinking预算与runSnapshot、ID提示、Qwen失败与DeepSeek选择、Windows/云端历史。
- [本轮完整Luna与实际上线结果](2026-10-20-workflow-resume.md)：全局规则、五次显式模型调度、失败/返修、Linux及Python测试、备份/500/恢复/身份核验、现有笔记隐私拦截。
- [生产证据](evidence/2026-10-20-workflow-resume/production-result.json)、[本次新鲜只读核验](evidence/2026-10-20-postdeployment-complete-archive/result.json)。
- [新增17份上线/恢复/核验代码封存](../implementation/2026-10-20-production-release-records/README.md)，与[之前16份准备期代码](../implementation/2026-10-20-production-update/README.md)分开保留；不得运行封存文件。
- [全局workflow/model规则快照](../coordination-policy-2026-10-20-workflow.md)、[故障测试源码](../../test/production-embedding-cleanup.test.py)、[本轮归档计划](../../plan_doc/2026-10-20-postdeployment-full-archive.md)。

## 当前代码与线上版本不是同一个标签

业务代码及测试已提交GitHub。归档前HEAD/origin main为`188bc3a23a8203ae57644cce023dffc11b79edc4`；实际生产为`91beebbcc3a99e725b5f35ac97245a80ca1195ea`。188bc仅结果/进度文档，不是新的运行时修复，受控业务源码与91be相同；本次再归档同样不触发追逐文档HEAD的重复部署。

- 91be实际Linux候选852/852，0失败/跳过；辅助门禁与新Python测试通过。
- 142受控源码全部hash一致，manifest为`afca77f6d8e867c64498bd6bf7a5eb0db9b84764653b1cbf68c817faf055f7f3`。
- 原非rootubuntu systemd用户服务及app/data/runtime路径保留；health正常，原active/lifecycle和授权列表/时控不变。
- 聊天实际DeepSeek Flash，生产固定文本HTTP200/OK，23报告tokens；不是仅修改仓库约定。
- 4B/2560实际enabled/configured、query=true/private=false；线上固定文本返回真实2560维，当前原有数据向量0不能当完整记忆链通过。

## 全部重要过程均保留

1. 全局AGENTS已实际修改并生效：所有委派workflow且每agent显式model，不用普通subagent/fork或复用旧会话绕过；架构/方向/最终验收由主协调者亲自负责。全局文件不在项目Git中，其无秘密规则快照已入库。
2. 上线续做阶段五次workflow均显式gpt-6-luna，后续显式codex-proxy：首轮max-tokens无产物、紧凑初稿、按协调者要求返修、独立清理复核、结果一致性复核全部有记录，不把失败倒改成功。本次再归档另有一次显式codex-proxy/gpt-6-luna封存实现调用，记录在新鲜状态证据中。
3. 当前故障矩阵每源4方法、18场景、2真实旧逻辑受控红例、1唯一性反例，两源及目标Linux通过；不泛化成整个产品/QQ验收。
4. 发布前保存原三历史快照、完整原应用/配置/单元及一致业务快照；主库和备份SQLite quick_check都ok，消息9904/outbox54/线程2未减少，Notebook293保留。
5. 91be代码部署完成后配置API因宿主selfId缺失返回500，外层停供；原FAILED记录保留。核对源码/权限后恢复新代码，不重跑发布或覆盖迁移数据。
6. 通过唯一现存协议账号配置、相同HTTP/WS端口令牌和同一Notebook账号交叉核验，仅补可信已有selfId到Agent配置。不是猜号/改账号/改笔记归属，不是实时QQ登录证明；协议容器没重启或改动，真实QQ号和身份文件不入Git。
7. 随后标准API保存/验证成功，当前SUCCESS与原始FAILED分开记录。
8. 旧293笔记中47不活跃/不可召回，246为chat私域，在allowPrivate=false下禁止外发；0符合索引外发条件、0排队/就绪。主笔记行摘要不变，没有靠放宽权限、改scope、假笔记/假向量完成指标。

## 仍未完成，不被归档或上线关闭

- OneBot更新前已有断连仍存在，未进行QQ登录/真实发送/SC8验收。
- B07视觉新增性、R06/B10更广语义、当前DeepSeek完整chat→reflection→4B→新会话召回、适用浏览器/真实平台验证。
- Windows旧44平台/夹具失败；Linux852全过不能倒改这些历史。
- [CFG-RB01通用配置精确回滚](../task/CFG-RB01-exact-self-evolution-rollback.md)：500后深合并可能留下新字段，仍OPEN；现有cleanup单元不覆盖它。
- [历史发布续做卡](../task/DEPLOY-2026-10-20-resume.md)保留当时时点，不能直接当当前待执行命令而重复发布。

## 安全与续做

原始日志/备份/数据/令牌/真实QQ身份留私有位置。Git只有源码、阻止直接执行的运维快照、脱敏结果与摘要，不含数据库、原始聊天笔记、运行时/依赖或源码tar。新增脚本原文与封存hash/脱敏变换在清单，不能拿封存hash冒充实际执行hash。

用户已授权后续实际收到的排队指令直接处理，不再提问；仍须自行核对实际状态和技术前提，不猜未收到任务、不绕过门禁或宣称未做验证。后续由主协调者阅读本总交接再定优先级/方案，所有执行者继续显式workflow/model。

本次新鲜只读核验为05:17:35 +08；服务及模型配置保持成功、142源码无差异，OneBot仍断连、隐私过滤和零向量结果未变。主协调者已对17份封存逐项校验原始/封存SHA、字节数、语法及硬退出；106个已有本地链接和已知秘密模式检查通过，见[本次归档校验](evidence/2026-10-20-postdeployment-complete-archive/archive-validation.json)。这些检查不扩大已有生产/语义验收结论。

最终再归档提交号以Git历史与push后回读为准；本次提交不新增线上动作，也不承诺最终供应商账单为零。
