# P1 Registry 与 Legacy Adapter

> 状态：planned。依据规划，不代表插件框架已经存在。

## 目标

增加可信内置插件的契约、注册表、管理器和运行级快照；将现有工具接入 Legacy Adapter，但在新能力关闭时保持完全行为兼容。

## 必须实现

- `contract`：校验插件 id/name/version/apiVersion、工具 schema、owner 和 effect 元数据。
- `registry`：staging 注册、重复工具名/重复 owner 冲突失败、稳定排序、原子发布、revision。
- `manager/context`：启用插件快照、配置快照、工具句柄和运行上下文的最小骨架。
- Legacy 插件登记现有工具；保留 `tools-core.js` 等旧导出，不能出现双重 owner。
- Orchestrator 在新 Run 使用同一份快照，旧过滤逻辑的结果和顺序可比较。

## 非目标与硬约束

- 不加入 Notebook、`stay_silent`、新 prompt 规则、发送队列重写、外部 npm 插件、热加载或沙箱。
- 不改变 Sender/Outbox、参数兼容、工具错误处理、多模态记录和 unknown 外发语义。
- 未分类工具默认顺序执行；只有 runtime-control 将来可以拥有终止权。

## 允许的自主决策

可决定文件拆分、内部类/函数名、快照对象实现和测试替身；接口字段、owner 唯一性、稳定排序和权限边界必须遵循规划，不得另造执行入口。

## 验收

- 新能力关闭时，工具名称、schema、顺序、过滤结果与 P0 基线一致。
- 重复注册、保留工具冒名、非法 schema 会失败且不会污染旧 registry。
- 同一 Run 多轮请求使用同一快照；下一 Run 才看到配置/注册变化。
- 现有发送和 unknown 处理回归通过。

## 验证建议

运行 P0 全部命令，并新增 Registry/快照单测；保存 schema diff 和测试退出码。

## 回退

移除装配开关或回到 P0 版本即可恢复旧工具路径；不得删除已有数据表或改变历史会话格式。
