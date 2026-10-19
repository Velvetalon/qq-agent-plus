# 未发布运维实现封存快照

**状态：FROZEN / INCOMPLETE / NOT PRODUCTION VALIDATED。这里不是部署入口。**

本目录保存本轮16份非秘密运维实现，供后续审阅和续做，避免代码只留在临时目录。业务代码以930及之前的Git提交为准，不在此重复复制。详见[完整交接](../../schedule/2026-10-20-complete-work-archive.md)、[续做卡](../../task/DEPLOY-2026-10-20-resume.md)、[逐文件哈希及变换](manifest.json)。

## 封存保护与差异

- 每份shell快照在正文前无条件exit64；Python快照在导入或读取环境/凭据前立即退出。不能用这些文件执行部署或模型调用。
- 原私有维护目录改为不存在的审阅占位符。真实现有目录及当时状态由完整交接记录，不应机械替换占位符后直接运行。
- [SSH适配器](ssh_remote.py)的外部凭据路径改为QQ_DEPLOY_SSH_CREDENTIALS环境变量；证据输出改为QQ_DEPLOY_EVIDENCE_DIR，禁止写入checkout；label受限。没有复制认证值。
- 因保护/脱敏，封存文件与原临时实现字节不同；manifest同时记录原始SHA256、封存SHA256、字节数和变换，不能把它们冒充实际部署时执行的版本。
- 最后[发布草稿](apply-update.sh)已补保存/测试异常清理，但尚未故障注入及最终复核；服务器仍是缺少该补丁的旧稿。**两份都不能直接用于续做发布。**
- 本目录只有代码，没有业务数据、原始日志、源tar包、runtime、node_modules或密钥。

## 全部代码清单

### 连接、盘点与隔离候选

- [ssh_remote.py](ssh_remote.py)：可信known_hosts和外部SSH字段适配器；需要已有paramiko，封存状态不运行。
- [preflight.sh](preflight.sh)：用户/系统/现存安装发现，只读逻辑。
- [inventory.sh](inventory.sh)：部署元数据及非秘密配置/健康盘点。
- [prepare.sh](prepare.sh)：创建独立维护目录及备份路径核验。
- [validate.sh](validate.sh)：固定归档校验、独立HOME/XDG、Node网络拦截、Linux852单测和辅助门禁。

### 发布草稿与安全检查

- [apply-update.sh](apply-update.sh)：备份、固定提交部署、最小配置、获准Embedding及后置验收；最后清理补丁待验。
- [launch-update.sh](launch-update.sh)：双层锁的一层、独立进程、pid/result与重复启动保护。
- [prelaunch-check.sh](prelaunch-check.sh)：只在私有模拟锁文件上做并发拒绝实验。
- [check_operator_scripts.py](check_operator_scripts.py)：shell/Python/JS语法与12组模拟守卫；不是最后Embedding异常故障矩阵。
- [rearm-known-failed-attempt.sh](rearm-known-failed-attempt.sh)：仅对已确认进程退出且未停服的失败保存标记，不能用于未知结果重试。

### 诊断、获准探针与最终只读状态

- [diagnose-rollout.sh](diagnose-rollout.sh)：首次失败与原服务状态诊断。
- [inspect-legacy-memory.sh](inspect-legacy-memory.sh)：原始命名保留；实际已确认canonical配置存在，不能据文件名继续断言“旧字段”。只查开关/表名/数量，不读正文。
- [probe-production-embedding.sh](probe-production-embedding.sh)：初次15秒固定文本探针，超时事实保留。
- [embedding-network-check.sh](embedding-network-check.sh)：无认证HEAD/DNS/TLS诊断，不发模型输入。
- [probe-embedding-transport.sh](probe-embedding-transport.sh)：匹配应用连接参数的有界固定文本实验；真实HTTP200/2560维/7tokens，非Notebook索引。
- [archive-readonly-status.sh](archive-readonly-status.sh)：归档时只读核验线上仍059、Qwen、未配置Embedding、无新备份/发布。

## 续做的最低条件

先读完整交接与续做卡，由主协调者重新确认目标、授权、真实路径和当前版本；在独立环境取出并审查所需正文，补齐异常故障矩阵与独立复核后，才可重新生成可执行实现。不得批量执行本目录、删除服务端未知标记、把占位路径当真实路径、读取未获准凭据或用生产服务做故障反例。
