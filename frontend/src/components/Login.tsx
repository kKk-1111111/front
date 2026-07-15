// Login.tsx — Supabase login/register/logout UI

import { useState, useEffect } from "react";
import { signIn, signUp, signOut, getCurrentSession, onAuthChange, AuthUser } from "../lib/supabase";

interface LoginProps {
  onAuthChange: (user: AuthUser | null) => void;
}

export function Login({ onAuthChange: onAuth }: LoginProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Restore session on page refresh
    getCurrentSession().then((u) => {
      setUser(u);
      onAuth(u);
    });
    // Listen for auth state changes (token refresh, logout)
    const unsub = onAuthChange((u) => {
      setUser(u);
      onAuth(u);
    });
    return unsub;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        const u = await signIn(email, password);
        if (!u) setError("登录失败");
      } else {
        const u = await signUp(email, password);
        if (!u) setError("注册失败或需要确认邮箱");
      }
    } catch (err: any) {
      setError(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
    onAuth(null);
    setEmail("");
    setPassword("");
  };

  if (user) {
    return (
      <div className="card">
        <div className="row">
          <span>当前用户: <b>{user.email}</b></span>
          <button className="sec" onClick={handleSignOut}>退出登录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>登录</h2>
      <form onSubmit={handleSubmit}>
        <div className="row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            style={{ minWidth: 240 }}
            required
          />
        </div>
        <div className="row">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            style={{ minWidth: 240 }}
            required
          />
        </div>
        <div className="row">
          <button type="submit" disabled={loading}>
            {mode === "login" ? "登录" : "注册"}
          </button>
          <button type="button" className="sec" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "切换到注册" : "切换到登录"}
          </button>
        </div>
        {error && <div className="err">{error}</div>}
      </form>
    </div>
  );
}
