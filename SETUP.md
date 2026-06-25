# Supabase 云同步 — 配置步骤

## 第一步：注册 Supabase 账号

1. 打开 https://supabase.com
2. 点击 "Start your project" → 用 GitHub 账号登录
3. 创建新组织（Organization），名称随意

## 第二步：创建项目

1. 点击 "New project"
2. 填写：
   - **Name**: `interview-prep`
   - **Database Password**: 设置一个密码并**记下来**
   - **Region**: 选 **Singapore (Southeast Asia)** 或 **West US** — 国内访问新加坡最快
3. 点击 "Create project"，等待 2 分钟初始化完成

## 第三步：创建数据表

1. 进入项目后，左侧菜单 → **SQL Editor**
2. 点击 "New query"，粘贴以下 SQL 并点击 **Run**：

```sql
-- 创建用户数据表
CREATE TABLE user_data (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  completion_history JSONB DEFAULT '{}'::jsonb,
  streak INTEGER DEFAULT 0,
  last_streak_date TEXT,
  daily_new_count INTEGER DEFAULT 5,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 启用行级安全
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的数据
CREATE POLICY "Users can read own data"
  ON user_data FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own data"
  ON user_data FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data"
  ON user_data FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 允许新用户注册
-- （Supabase 默认已允许，如果注册报错再运行下面的）
-- ALTER ROLE authenticator SET pgrst.jwt_claims TO 'role';
```

3. 确认左边 Database → Tables 出现了 `user_data` 表

## 第四步：获取 API 密钥

1. 左侧菜单 → **Settings** → **API**
2. 复制以下两个值：
   - **Project URL**（例如 `https://xxxxx.supabase.co`）
   - **anon public key**（以 `eyJ...` 开头的长字符串）

## 第五步：配置到代码中

编辑 `js/sync.js` 第 7-8 行：

```js
const SUPABASE_URL = "https://xxxxx.supabase.co";  // 粘贴你的 Project URL
const SUPABASE_ANON_KEY = "eyJ...";                  // 粘贴你的 anon key
```

## 第六步：测试

1. 双击打开 `index.html`
2. Header 左侧会看到 **🔴 未登录** 按钮
3. 点击 → 输入邮箱 + 密码 → 点「注册」
4. 注册成功后自动登录，状态灯变 **🟢 已同步**
5. 勾选几道题 → 等待 2 秒自动推送
6. 在另一台设备/浏览器打开 → 登录同一账号 → 数据自动拉取

## 故障排查

| 问题 | 解决 |
|------|------|
| 注册报错 | 检查 email/password 格式（密码 ≥ 6 位） |
| 同步无反应 | 打开浏览器控制台（F12）查看错误日志 |
| Supabase SDK 加载失败 | 检查网络是否能访问 jsdelivr CDN |
| 状态灯显示"离线模式" | Supabase 脚本加载失败，检查 CDN 连接 |
