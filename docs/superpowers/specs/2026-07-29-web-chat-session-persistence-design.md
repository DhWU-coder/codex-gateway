# Web Chat Session 持久化设计

## 目标

修复 Web Chat 登录状态仅保存在 Gateway 进程内存中的问题。多个客户端登录本身互不影响；Gateway 重启后，已签发且未过期的 Session 应继续有效。任何 Chat API 返回 `401` 时，页面应立即清理旧状态并回到登录界面。

## 根因

`WebChatAuthService` 当前使用进程内 `Map` 保存 Session。服务重启会创建新的认证服务实例，旧 Cookie 无法在新实例中找到，因此所有客户端同时收到 `401`。页面的通用 API 客户端没有统一处理 `401`，导致旧工作区继续显示并弹出“请先登录”。

## 持久化格式

Session 文件固定保存到：

```text
~/.codex-gateway/web-chat/auth-sessions.json
```

文件使用版本化 JSON：

```json
{
  "version": 1,
  "sessions": [
    {
      "tokenHash": "<sha256>",
      "csrfToken": "<opaque token>",
      "userId": "<immutable user id>",
      "expiresAt": 1785330000000
    }
  ]
}
```

原始 Session Token 只存在浏览器 HttpOnly Cookie 和当前请求中。磁盘只保存 SHA-256 哈希，文件权限为 `0600`，目录权限为 `0700`，写入继续采用临时文件加原子重命名。

## 生命周期

- 登录或注册成功：创建随机 Session Token 和 CSRF Token，保存令牌哈希后返回 Cookie。
- 服务启动：读取 Session 文件，恢复未过期且用户存在、启用的记录。
- 请求认证：对 Cookie Token 计算哈希后查找 Session。
- 退出：仅删除当前 Cookie 对应的 Session。
- 修改密码、管理员重置密码、停用或删除用户：删除该用户的全部 Session。
- Session 过期或用户失效：认证时删除对应记录并写回。
- 文件缺失：视为空 Session 集合。
- 文件损坏：安全地视为空集合，不恢复任何 Session。

升级后的第一次重启无法恢复旧版本仅存在内存中的 Session；用户重新登录后，新 Session 才会进入持久化文件。

## 前端行为

通用 `api` 函数遇到 `401` 时统一执行认证状态重置：

- 关闭 EventSource；
- 清空用户、CSRF、Session、消息和流式文本状态；
- 切回登录标签；
- 隐藏 Chat 工作区并显示登录页。

登录和注册接口仍使用独立的未认证请求流程，不受该处理影响。

## 验证

- 登录后重建 `WebChatAuthService`，旧 Cookie 仍能认证；
- Session 文件不包含原始 Cookie Token；
- 退出只撤销当前 Session，其他客户端保持登录；
- 改密、停用和管理员撤销在重建认证服务后仍然无效；
- 过期 Session 不会在重建后恢复；
- 页面脚本在通用 API 收到 `401` 时回到登录页；
- 全量测试、类型检查、构建和真实后台重启流程通过。
