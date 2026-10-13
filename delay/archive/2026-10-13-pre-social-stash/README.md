# 旧的未完成 LSR 代码归档

本目录只保全历史工作，不属于当前拟人内核实现，也不提供自动恢复入口。

- 来源stash：4acd836b64734e1f208a7cdb1a9d8e1fb7a90bd0。
- 来源说明：On main: preserve partial learned-self repair before 059eba5。
- 基线提交：b1c3a682d7eebe7a8ed80747375b2f5839901dfd。
- 涉及文件：src/plugins/self-evolution/reflection-store.js。
- 归档：[reflection-store.partial.patch](reflection-store.partial.patch)，18209字节。
- SHA-256：6A82E657AE9CE47E4A1746858099F2327A70ED33765F13337DF45ABEFAC64D26。

该补丁使用git diff --binary从stash机械导出，未应用、未修改；原stash在原机器保留。它早于已合入的059eba5，与后续实现存在重叠和冲突，不能git apply后直接运行。

用途仅为审计或人工对照，后续开发优先遵循 /plan_doc 的完整设计和 /delay/schedule 的WIP交接。不要把这份旧代码作为“测试通过”的修复，也不要将其拼接到生产。
