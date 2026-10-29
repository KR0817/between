"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation refreshes the platform account and restores the locally held invite. */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Copy, Check, Download, Plus, Link2, MessageCircle, FileText, ShieldCheck, X } from "lucide-react";
import { z } from "zod";
import { accountCanChat, accountSchema, requestJson, saveInviteBeforeNavigation, SignInLink, verificationLabels, type Account } from "../components/governance";

type Item = { id: string; text: string; filename: string | null; size: number | null; created: number; mine: boolean };
type Snapshot = { expires: number; joined: boolean; online: boolean; messages: Item[] };
const errorSchema = z.object({ error: z.string() });
const snapshotSchema = z.object({ expires: z.number(), joined: z.boolean(), online: z.boolean(), messages: z.array(z.object({ id: z.string(), text: z.string(), filename: z.string().nullable(), size: z.number().nullable(), created: z.number(), mine: z.boolean() })) });
const sizeText = (size: number) => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;

export default function Home() {
  const [token, setToken] = useState(""); const [account, setAccount] = useState<Account | null>(null);
  const [legacyMember, setLegacyMember] = useState(""); const [notice, setNotice] = useState("");
  const [state, setState] = useState<Snapshot | null>(null); const [draft, setDraft] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false); const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState<number | null>(null); const [invite, setInvite] = useState("");
  const [downloadId, setDownloadId] = useState(""); const [link, setLink] = useState("");
  const fileInput = useRef<HTMLInputElement>(null); const end = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const allowed = accountCanChat(account);
  // Browser-held legacy identity and URL state are restored only after hydration.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Read the legacy browser value only after hydration.
      setLegacyMember(localStorage.getItem("between-member") || "");
      const saved = sessionStorage.getItem("between-return-invite");
      if (!location.hash && saved && /^[a-f0-9]{64}$/.test(saved)) history.replaceState(null, "", `/#${saved}`);
      sessionStorage.removeItem("between-return-invite");
    } catch { setError("浏览器未允许读取本地暂存。登录后请重新粘贴邀请链接；旧版房间删除可能需要原浏览器记录。"); }
    let active = true;
    void requestJson("/api/account", undefined, "GET").then(value => { if (active) setAccount(accountSchema.parse(value)); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "无法读取账户状态"); });
    const read = () => { const value = location.hash.slice(1); const key = /^[a-f0-9]{64}$/.test(value) ? value : ""; setToken(key); setLink(key ? `${location.origin}/#${key}` : ""); setState(null); setConnected(false); };
    read(); window.addEventListener("hashchange", read); return () => { active = false; window.removeEventListener("hashchange", read); };
  }, []);
  const headers = () => ({ "x-room": token });
  async function api(path: string, data?: unknown) {
    const response = await fetch(path, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await response.json(); if (!response.ok) throw new Error(errorSchema.parse(result).error); return result;
  }
  useEffect(() => {
    if (!token || !allowed) return;
    let active = true; let timer: ReturnType<typeof setTimeout>; let joined = false;
    async function poll() {
      try {
        const response = await fetch(joined ? "/api/rooms/sync" : "/api/rooms/join", { method: "POST", headers: { "x-room": token } });
        const value = await response.json();
        if (!active) return;
        if (!response.ok) { setError(errorSchema.parse(value).error); setConnected(false); if ([401,403,410].includes(response.status)) { setState(null); return; } }
        else { joined = true; setState(snapshotSchema.parse(value)); setConnected(true); }
      } catch { if (active) setConnected(false); }
      if (active) timer = setTimeout(poll, document.hidden ? 5000 : 2000);
    }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [token, allowed]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [state?.messages.length]);
  function showError(e: unknown) { setError(e instanceof Error ? e.message : "连接失败，请检查网络后重试"); }
  async function create() {
    if (!allowed || !account?.maintenanceHealthy) return;
    setBusy(true); setError("");
    try { const value = z.object({ token: z.string() }).parse(await api("/api/rooms")); location.hash = value.token; } catch (e) { showError(e); } finally { setBusy(false); }
  }
  function join() {
    try {
      const value = invite.trim(); const key = value.includes("#") ? new URL(value).hash.slice(1) : value;
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("请粘贴完整的邀请链接");
      setError(""); location.hash = key;
    } catch (e) { showError(e); }
  }
  async function send() {
    if (!draft.trim() || busy || !connected || !allowed) return;
    setBusy(true); setError("");
    try { await api("/api/messages", { text: draft }); setDraft(""); setState(snapshotSchema.parse(await api("/api/rooms/sync"))); }
    catch (e) { showError(e); } finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || busy || !connected || !allowed) return;
    if (file.size > 20 * 1024 * 1024) { setError("单个文件不能超过 20 MB"); return; }
    setBusy(true); setProgress(0); setError("");
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/files"); xhr.timeout = 180000;
        Object.entries(headers()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onerror = () => reject(new Error("网络中断，文件发送失败，请重试"));
        xhr.ontimeout = () => reject(new Error("上传超时，请刷新会话确认后重试"));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else { try { reject(new Error(JSON.parse(xhr.responseText).error)); } catch { reject(new Error("文件发送失败，请重试")); } }
        };
        xhr.send(file);
      });
      setState(snapshotSchema.parse(await api("/api/rooms/sync")));
    } catch (e) { showError(e); } finally { setBusy(false); setProgress(null); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function download(item: Item) {
    setDownloadId(item.id); setError("");
    try {
      const response = await fetch(`/api/files/${item.id}`, { headers: headers() });
      if (!response.ok) { const value = errorSchema.parse(await response.json()); throw new Error(value.error); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = item.filename || "download"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { showError(e); } finally { setDownloadId(""); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError("无法自动复制，请选中下方邀请链接手动复制。"); }
  }
  async function deleteRoom() {
    if (!confirm("删除当前房间将立即停止双方访问，并排队清除双方消息和文件。该操作无法撤销，对方已经下载的副本不会被撤回。确认删除？")) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/rooms/delete", {}, "POST", { "x-room": token, ...(legacyMember ? { "x-member": legacyMember } : {}) });
      location.hash = ""; setState(null); setConnected(false); setDraft("");
      setNotice("房间已关闭，双方消息和文件已进入删除队列。清理会重试失败项目；完成时间受任务运行和存储状态影响。");
    } catch (e) { showError(e); } finally { setBusy(false); }
  }
  const ready = allowed && token && state;
  return <main className="shell">
    <header className="topbar"><a className="brand" href="/" aria-label="Between 首页"><span className="brand-mark"><i /><i /></span><span>between<span className="brand-period">.</span></span></a><span className="top-note">留一个空间，给你们两个人。</span><span className="badge"><span />双人会话</span></header>
    <section className="account-banner" aria-label="账户状态"><div><strong>{!account ? "正在读取账户…" : !account.signedIn ? "先登录，再完成身份核验" : allowed ? "账户已核验，可以开始会话" : !account.accepted ? "请先阅读隐私告知并确认成年" : account.verification === "verified" ? "核验已到期，请重新申请" : verificationLabels[account.verification]}</strong><p>仅供成年人使用 · 身份核验通过后开放通信</p></div><div className="action-row">{account && !account.signedIn && <SignInLink onError={setError} />}<a className="secondary action-link" href="/governance#account" onClick={e => { try { saveInviteBeforeNavigation(); } catch { e.preventDefault(); setError("无法暂存邀请链接，请复制链接后从页脚进入账户页面。"); } }}>账户与隐私</a></div></section>
    {notice && <div className="room-notice" role="status">{notice}</div>}
    {account && !account.maintenanceHealthy && <div className="room-notice" role="status">清理维护暂不可用，已暂停创建新房间。已有房间仍按原期限关闭；删除请求可以提交。运营者可在管理页面检查并重试清理。</div>}
    <section className="workspace">
      <aside className="sidebar">
        <div className="side-heading"><span className="eyebrow">JUST THE TWO OF YOU</span><h1>两个人，<br />刚刚好。</h1><p>聊几句，把文件递给对方。<br />打开同一个链接，就在一起。</p></div>
        <div className="room-card"><div className="section-label"><MessageCircle size={16} />{token ? "当前房间" : "你的会话空间"}</div>
          <div className="presence"><span className="avatar self">我</span><span className={`bridge ${state?.online && connected ? "live" : ""}`}><i /><i /><i /></span><span className={`avatar ${state?.online && connected ? "peer" : "waiting"}`}>{state?.joined ? "TA" : "?"}</span></div>
          <p className="presence-caption">{!token ? "一端是你，一端是对方" : !connected ? "正在连接房间…" : state?.online ? "你们都在这里" : state?.joined ? "对方暂时离线" : "等待对方加入"}</p>
          {token && <><button className="primary wide" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "已复制邀请链接" : "复制邀请链接"}</button><input className="share-url" aria-label="邀请链接" value={link} readOnly onFocus={e => e.target.select()} /><p className="tiny">仅把链接发给你想邀请的人</p></>}
          {!token && <button className="primary wide" onClick={create} disabled={!allowed || !account?.maintenanceHealthy || busy}><Plus size={17} />{busy ? "正在创建…" : "创建双人房间"}</button>}
        </div>
        {token && <div className="room-actions"><button className="danger-text" disabled={busy || (!account?.signedIn && !legacyMember)} onClick={() => void deleteRoom()}>删除房间及双方内容</button><a className="inline-link" href="/governance#complaints" onClick={e => { try { saveInviteBeforeNavigation(); } catch { e.preventDefault(); setError("无法暂存房间信息，可从页脚进入投诉页面并说明情况。"); } }}>投诉当前房间</a></div>}
        <div className="room-info"><div><ShieldCheck size={18} /><span>最多两个人加入</span></div><div><FileText size={18} /><span>单个文件最大 20 MB</span></div><div><Link2 size={18} /><span>邀请链接 24 小时有效</span></div></div>
        <div className="side-bottom"><p>连接简单一点，交流自在一点。</p>{token && <button className="text-button" disabled={busy} onClick={() => { if (confirm("创建新房间后仍可通过原链接返回，是否继续？")) void create(); }}><Plus size={15} />创建另一个房间</button>}</div>
      </aside>
      <section className="conversation" aria-label="聊天区域" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}>
        <header className="conversation-header"><div><h2>{token ? "你们的会话" : "从一个链接开始"}</h2><p>{token ? connected ? state?.online ? "对方在线 · 消息每 2 秒同步" : "房间已连接 · 可以先留消息" : "连接中，暂时无法发送" : "不用加好友，也不用安装应用"}</p></div><span className={`status-pill ${connected ? "online" : ""}`}><i />{token ? connected ? "已连接" : "连接中" : "准备就绪"}</span></header>
        {error && <div className="error" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError("")}><X size={16} /></button></div>}
        {!ready ? <div className="welcome"><div className="connection-art" aria-hidden="true"><span><MessageCircle size={34} strokeWidth={1.5} /></span><b>···</b><span><Paperclip size={34} strokeWidth={1.5} /></span></div><span className="eyebrow">A LITTLE CLOSER</span><h2>{token ? allowed ? "正在打开你们的房间" : "先完成账户核验" : "话和文件，都能好好送达。"}</h2><p>{token ? allowed ? "连接成功后，就可以开始聊天。" : "邀请已保留。请先在账户页面确认隐私告知并完成核验。" : "创建房间，把邀请链接发给对方。\n文字与文件，在这里相遇。"}</p>{!token && <><button className="primary start" disabled={!allowed || !account?.maintenanceHealthy || busy} onClick={create}>{busy ? "正在创建…" : "开启一段会话"}<ArrowUp className="diagonal" size={18} /></button><div className="join"><label htmlFor="invite">已经收到邀请？</label><div><input id="invite" placeholder="粘贴对方发来的邀请链接" value={invite} onChange={e => setInvite(e.target.value)} onKeyDown={e => { if (e.key === "Enter") join(); }} /><button onClick={join} disabled={!invite.trim() || !allowed}>加入房间</button></div></div></>}</div> : <div className="messages" role="log" aria-live="polite" aria-relevant="additions"><div className="date-divider">这段对话 · 24 小时内可访问</div>{state.messages.length === 0 && <div className="empty-chat"><span className="empty-icon"><MessageCircle size={28} /></span><h3>{state.joined ? "发出第一句问候吧" : "房间已经准备好了"}</h3><p>把邀请链接发给对方，也可以先留下一条消息。</p></div>}{state.messages.map(item => <article key={item.id} className={`message ${item.mine ? "mine" : "theirs"}`}><span className="message-label">{item.mine ? "我" : "对方"}<time>{new Date(item.created).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></span>{item.filename !== null ? <div className="file-bubble"><span className="file-icon"><FileText size={24} /></span><div><strong>{item.filename}</strong><small>{sizeText(item.size || 0)} · 可下载</small></div><button onClick={() => download(item)} disabled={downloadId === item.id} aria-label={`下载 ${item.filename}`}><Download size={18} /></button></div> : <div className="bubble">{item.text}</div>}</article>)}<div ref={end} /></div>}
        <div className="composer-wrap">{progress !== null && <div className="upload-state"><span>{progress === 100 ? "正在保存文件…" : `正在上传 ${progress}%`}</span><progress value={progress} max={100} /></div>}<div className="composer"><input ref={fileInput} type="file" className="hidden" onChange={e => upload(e.target.files?.[0])} /><button className="attach" aria-label="选择文件" title="选择文件，最大 20 MB" disabled={!connected || busy} onClick={() => fileInput.current?.click()}><Paperclip size={22} /></button><textarea aria-label="输入消息" placeholder={token ? "写点什么…" : "先创建或加入房间"} disabled={!connected || busy} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current) { e.preventDefault(); void send(); } }} /><button className="send" aria-label="发送消息" disabled={!connected || busy || !draft.trim()} onClick={send}><ArrowUp size={21} /></button></div><div className="composer-foot"><span>支持拖入文件 · Enter 发送 / Shift + Enter 换行</span><span>{draft.length > 0 ? `${draft.length}/4000` : "只属于这一次相遇"}</span></div></div>
      </section>
    </section>
    <footer className="footer"><span>BETWEEN · 两个人的轻量会话</span><span>24 小时后关闭并排队清理 · 非端到端加密 · 请勿传输敏感资料</span><nav aria-label="隐私和支持"><a href="/governance#privacy">隐私告知</a><a href="/governance#complaints">投诉与权利请求</a></nav></footer>
  </main>;
}
