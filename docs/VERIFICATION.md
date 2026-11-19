# 验证记录

环境：Windows，DSH 0.2.2-rc.5，desktop profile，Node.js（DSH 自带运行时）。

## 自动检查

`node --test tests/core.test.js tests/host.test.js`：24 项通过，0 失败，0 跳过。另覆盖显式 planning 状态的旧数据兼容、嵌套校验、部分合并、版本审批生命周期，以及三个原生工程 Skill 的注册和清理。

覆盖：工作区隔离、revision 冲突、同进程/跨进程互斥、DAG、审批身份、依赖门禁、声明文件排他、验收证据、重新执行清理证据、重新规划和历史保留、路径与链接、导出重建、实际 LF/NUL/反斜线字节行为、损坏列表容错、Host 工具与人工命令共用核心、资源释放。

`node scripts/validate-package.mjs`：资源路径、清单导出及双语元数据检查通过。

## 审查

核心只读审查发现损坏条目影响整个列表；已修复为逐项 warnings，增加回归测试。

Host/Client 集成检查发现任务保存包含只读状态字段，已修复为仅提交规划字段。UI/UX 静态专家审查后已补齐会话内存草稿恢复、跨变更资料表单清理与未提交内容守卫。最终 client.js 语法检查通过。

## 安装与运行

已通过 plugin_manager 将 @local/dsh-engineering-planner 0.2.0 重新安装到 desktop profile，返回 application: applied、enabled: true。调用实际 engineering_plan list 返回 changes: []、warnings: []。运行时技能目录出现 engineering-planning、architecture-design、engineering-review，且实际加载 engineering-review 成功。此前 0.1.0 Client Inspect 确认 conversation.view 中 engineering-planner 条目 active: true、order: 40；新版实际页面点击验收仍待完成。原生会话入口采用插入并保存输入草稿，不自动提交，也不把准备请求标为任务已执行。

新版界面静态审查修复了三项草稿问题：资料尚未加入时禁用保存；运行状态与证据表单独立缓存并保护未提交内容；开发规划显示原生会话请求入口。最终 client.js 语法检查通过。

## 实际页面验证限制

首次 browser_open 返回：`the DSH window did not answer in time. Is the app window open?`；安装后重试返回：`the tab opened but no page appeared for http://127.0.0.1:60069 within 10 s`。未使用模拟页面替代真实运行界面。明暗主题、实际图标呈现、点击交互与页面控制台尚待真实页面验证。

证据记录功能经过测试，但不等于独立的代码验收执行器。EAP 项目只读参考，没有安装第三方推荐插件，也没有修改 EAP 源码。
