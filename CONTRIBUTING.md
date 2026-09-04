# 参与贡献

感谢你帮助改进 Video Language Helper。普通问题、功能建议和兼容性反馈请使用 GitHub Issues；安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 提交修改

1. 先搜索已有 Issue；较大的功能或行为变更请先开 Issue 对齐范围。
2. 从最新 `main` 创建独立分支，只修改与该问题相关的文件。
3. 不提交 API 密钥、Cookie、个人录音、账号数据、受版权保护的字幕或网站私有响应。
4. 安装 Node.js 22 或更新版本并运行：

   ```sh
   npm ci
   npm test
   npm run typecheck
   npm run test:integration
   ```

5. 提交信息说明用户可见的变化和验证方法。Pull Request 必须解决审查意见并通过自动检查。

## Developer Certificate of Origin

每个提交都必须包含 `Signed-off-by`，表示你确认自己有权按本项目许可证提交该贡献。请使用：

```sh
git commit -s -m "简明描述本次修改"
```

贡献按项目的 `GPL-3.0-only` 许可证接收；贡献者保留各自代码的版权。维护者可以拒绝超出项目范围、无法验证、包含凭据或来源不明的贡献。
