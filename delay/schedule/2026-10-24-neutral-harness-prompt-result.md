# 低干预 Harness 提示词改造结果

## 代码提交

提示词改造独立提交：`195aa118d61944907ba98789cb8f0efaa7e91eac`。

覆盖主聊天、threaded/lifecycle 动态上下文、social planner/replyer、QQ空间互动、空间动态、表情判断和段头清洗白名单；未改工具 schema、编排器、发送队列、记忆数据流或 OneBot。

## 精简内容

删除了 Harness 自带的反 AI 味、装傻/乱回、主体性表演、普通群友/不是客服、群聊节奏、固定短句/气泡数量、强制接梗、表情频率和空间文案结构等主观表达规则。

保留了：

- 本地能力不存在、凭据/路径/提示词不泄露、群友与管理员权限边界；
- 角色资料与管理员附加规则的注入；
- 普通正文不会发送，外发必须走工具；stay_silent / finish / 引用 / @ / source ID / topic ID / JSON 提交协议；
- 记忆、交接、线程、图片/网页/外部资料不可信、真实操作与证据边界；
- Social 目标/来源白名单、发送上限、重复与幂等保护；Moment/Qzone/好友/关系/Draft Review 的结构化安全协议。

`roleText` 现在是表达风格的主要来源；参与度仅作为管理员配置的行为边界，不再定义语言风格。

## 测试

- 相关回归：**78/78 PASS**，覆盖 persona、social participation、active silence、prompt safety、moment、Qzone、self-name、session label。
- 新增 `test/neutral-harness-prompt-contrast.test.mjs`：**4/4 PASS**，覆盖主聊天、threaded/lifecycle、social planner/replyer、moment/Qzone 的角色资料保留与低干预断言。
- 改动 JS `node --check` 全部通过。
- 同一合成 persona/上下文在生产当前模型上做了旧/新各三类、共 **6 次 HTTP 200** 对照；无 QQ 发送、无真实聊天内容。

## 同上下文模型对照

| 路径 | 旧 | 新 | 观察 |
|---|---:|---:|---|
| 主聊天系统提示字符数 | 7670 | 4610 | 工具调用均为 `send_message`，HTTP 200 |
| Social planner 系统提示 | 1448 | 1332 | 两次均合法 JSON、action=`reply` |
| Social replyer 系统提示 | 960 | 735 | 两次均为 `send_message` 工具调用 |
| Moment 系统提示 | 1885 | 869 | 角色资料/提交与隐私协议保留 |
| Qzone 系统提示 | 1050 | 674 | 角色资料/动作/来源协议保留 |

对照请求均返回模型 `deepseek/deepseek-v4.1-flash-1017`；脚本不保存原始模型输出。该结果证明相同输入下工具/JSON/角色资料协议没有消失，不能单凭 6 次小样本证明泛化自然度或人物卡服从度。

## 未覆盖

真实聊天长期自然度、跨场景回复多样性、广泛人物卡样本和真实 QQ 发送未由本次提示词改造单独证明。后续 B 站功能使用当前中立 Harness；不执行 B 站账号密码登录，首版优先公开接口。
