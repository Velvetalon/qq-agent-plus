# P0 基线、兼容与 sqlite-vec 预检

状态：planned

## 任务包

基线：`f745111a3a680a24e226870bccff5c5cc79eed2d`

目标：确认当前真实代码、运行时和依赖状态，冻结 A-D 使用的兼容边界；验证目标运行时可以
安全加载锁定版本的 sqlite-vec。此卡不改业务逻辑，不发 QQ 消息，不开启生产付费能力。

## 允许范围

- 读取 `AGENTS.md`、实验规范、部署文档和 package scripts；
- 新增只读 smoke test 或验证脚本；
- 记录当前 HEAD、工作区、Node、平台、架构、sqlite、package lock；
- 必要时新增依赖并锁定 lockfile，但必须先说明版本和平台兼容性；
- 不修改生产数据、配置、systemd、端口或服务。

## 固定约束

- 使用 `E:\node22\node.exe` 验证 Windows 开发运行时；
- 使用与部署一致的 Node 22 runtime 验证 Linux sqlite-vec；
- `DatabaseSync(..., { allowExtension: true })` 后只从固定依赖路径加载扩展；
- 加载后立即 `enableLoadExtension(false)`；
- 用 `vec_version()` 和 `vec_distance_cosine()` 验证两个有限 Float32 向量；
- 加载失败必须明确记录 `extension-unavailable`，不得把自制 n-gram、手写余弦或聊天模型数组
  当作替代实现。

## 验收

1. 记录实际 HEAD 和工作区状态。
2. `npm ci` 在干净临时目录可完成。
3. sqlite-vec smoke 输出版本和正交向量距离，且维度/NaN/零向量边界有检查。
4. 既有 Notebook CRUD、Reflection、Retrieval、Prompt focused tests 结果已记录。
5. 明确目标 Linux 运行时是否能用同一锁定依赖。

## 交付

返回验证脚本、依赖版本、命令/退出码、`LIVE_NOT_RUN` 项、A-D 依赖假设和回退：
卸载向量能力时 Notebook 正文仍可读写，召回显示不可用，不破坏主聊天。
