"use client";

import { useState, type MouseEvent } from "react";
import { z } from "zod";

export const accountSchema = z.object({
  signedIn: z.boolean(), member: z.string(), email: z.string(), admin: z.boolean(),
  accepted: z.boolean(), verification: z.enum(["none", "pending", "verified", "rejected", "revoked"]),
  verifiedUntil: z.number().nullable(),
  maintenanceHealthy: z.boolean(), lastMaintenance: z.number().nullable(),
});
export type Account = z.infer<typeof accountSchema>;
export const verificationLabels: Record<Account["verification"], string> = {
  none: "尚未申请核验", pending: "等待人工核验", verified: "核验已通过", rejected: "核验未通过", revoked: "核验已撤销",
};

export async function requestJson(path: string, data?: unknown, method = "POST", headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(error.success ? error.data.error : "操作失败，请稍后重试");
  }
  return value;
}

export function accountCanChat(account: Account | null): boolean {
  return !!account?.signedIn && account.accepted && account.verification === "verified" && (account.verifiedUntil ?? 0) > Date.now();
}

export function saveInviteBeforeNavigation(): void {
  const token = location.hash.slice(1);
  if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem("between-return-invite", token);
}

export function SignInLink({ onError }: { onError: (message: string) => void }) {
  function beforeSignIn(event: MouseEvent<HTMLAnchorElement>) {
    try { saveInviteBeforeNavigation(); }
    catch { event.preventDefault(); onError("浏览器无法暂存邀请链接。请先复制邀请链接，再从账户页面登录。"); }
  }
  return <a className="primary action-link" href="/signin-with-chatgpt?return_to=%2F" target="_top" onClick={beforeSignIn}>使用 ChatGPT 账户登录</a>;
}

export function AccountPanel({ account, refresh }: { account: Account | null; refresh: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function act(path: string, data: unknown, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await requestJson(path, data); await refresh(); setNotice(message); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  }
  return <section className="governance-card" id="account" aria-labelledby="account-title">
    <span className="eyebrow">YOUR ACCOUNT</span><h2 id="account-title">账户与身份核验</h2>
    <p>本服务仅面向成年人。登录、隐私确认和身份核验完成后，才可创建房间、聊天和传文件。ChatGPT 登录只用于账户识别。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {!account ? <p role="status">正在读取账户…</p> : !account.signedIn ? <SignInLink onError={setError} /> : <>
      <dl className="account-facts"><div><dt>登录邮箱</dt><dd>{account.email}</dd></div><div><dt>账户引用</dt><dd className="mono">{account.member}</dd></div><div><dt>核验状态</dt><dd>{account.verification === "verified" && !accountCanChat({ ...account, accepted: true }) ? "核验已到期，请重新申请" : verificationLabels[account.verification]}{account.verifiedUntil ? ` · 有效至 ${new Date(account.verifiedUntil).toLocaleDateString("zh-CN")}` : ""}</dd></div></dl>
      {!account.accepted ? <div className="consent-box">
        <label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /> <span>我已阅读并同意<a href="#privacy" className="inline-link">隐私告知（2026-10-30）</a>，了解数据处理目的、保存期限和权利行使方式。</span></label>
        <label className="check-label"><input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} /> <span>我确认已年满 18 周岁。</span></label>
        <button className="primary" disabled={busy || !accepted || !adult} onClick={() => void act("/api/account/consent", { version: "2026-10-30", accept: true, adult: true }, "隐私确认已保存，可以申请身份核验。")}>保存确认</button>
      </div> : <p className="form-success">已确认当前隐私告知及成年声明。</p>}
      <div className="notice-box"><strong>人工核验如何进行</strong><p>先提交申请，再联系运营者 <a className="inline-link" href="mailto:glah1005@163.com">glah1005@163.com</a>，提供上方账户引用并约定实际核验方式。本站不接收身份证件照片，请勿在聊天、投诉或邮件中直接发送证件照片。只有运营者完成实际核验后才可批准；提交申请本身不会开通通信。</p><p>当前未接入自动实名服务商，人工流程的法律适用性仍需运营者确认。</p></div>
      <div className="action-row"><button className="primary" disabled={busy || !account.accepted || account.verification === "pending" || accountCanChat(account)} onClick={() => void act("/api/account/verification", {}, "申请已提交。请联系运营者约定实际核验，核验完成前无法使用通信功能。")}>{account.verification === "pending" ? "申请已提交，等待核验" : "申请身份核验"}</button><button className="secondary" disabled={busy} onClick={() => { setError(""); void refresh().catch(e => setError(e instanceof Error ? e.message : "刷新失败")); }}>刷新状态</button></div>
      <div className="account-exit"><a className="inline-link" href="/signout-with-chatgpt?return_to=%2F" target="_top">退出登录</a><button className="danger-text" disabled={busy} onClick={() => { if (confirm("注销本站账户将撤销核验和隐私确认，并关闭、排队删除你参与的房间，包括双方消息和文件。对方已下载的副本不会被撤回。必要安全记录按告知期限保留。确认注销？")) void act("/api/account/delete", {}, "本站账户记录已注销，相关房间已排队删除。该操作不会注销你的 ChatGPT 账户。请退出登录以结束会话。"); }}>注销本站账户并撤回同意</button></div>
    </>}
  </section>;
}
