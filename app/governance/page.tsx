"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation refreshes the platform account and restores the locally held invite. */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { AccountPanel, accountSchema, requestJson, verificationLabels, type Account } from "../../components/governance";

const complaintResultSchema = z.object({ status: z.string(), reply: z.string(), created: z.number(), updated: z.number() });
const overviewSchema = z.object({
  accounts: z.array(z.object({ id: z.string(), requested: z.number().nullable(), verification: z.enum(["none", "pending", "verified", "rejected", "revoked"]), reviewed: z.number().nullable(), verified_until: z.number().nullable() })),
  complaints: z.array(z.object({ id: z.string(), category: z.string(), details: z.string(), contact: z.string().nullable(), status: z.string(), reply: z.string(), created: z.number(), updated: z.number(), hasRoom: z.boolean() })),
  counts: z.object({ active: z.number(), queued: z.number(), legacy: z.number() }),
  lastMaintenance: z.object({ last_run: z.number(), last_success: z.number().nullable(), failures: z.number() }).nullable(),
});
type Overview = z.infer<typeof overviewSchema>;
const statusLabels: Record<string, string> = { received: "已收到", open: "已收到", pending: "待处理", in_progress: "处理中", resolved: "已处理", rejected: "不予受理" };
const categoryLabels: Record<string, string> = { privacy: "隐私与个人信息权利", content: "违法或不当内容", account: "账户与身份核验", other: "其他问题" };
const timeText = (value: number | null) => value ? new Date(value).toLocaleString("zh-CN") : "暂无记录";
const messageOf = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";

function PrivacyNotice() {
  return <section className="governance-card privacy-copy" id="privacy" aria-labelledby="privacy-title">
    <span className="eyebrow">PRIVACY NOTICE · 2026-10-30</span><h2 id="privacy-title">隐私告知与使用边界</h2>
    <p>Between 由余新波运营，联系邮箱为 <a className="inline-link" href="mailto:glah1005@163.com">glah1005@163.com</a>。本站为成年人提供双人文字会话和文件中转。使用通信功能前，需要登录、确认本告知并完成运营者身份核验。请仅邀请你认识且愿意交流的人，并确保你有权发送相应内容。</p>
    <h3>我们处理什么信息、用于什么目的</h3>
    <div className="privacy-table-wrap"><table className="privacy-table"><thead><tr><th>信息</th><th>用途与来源</th></tr></thead><tbody>
      <tr><td>平台账户标识、邮箱</td><td>由 Sites 登录提供，用于识别账户、展示登录状态和执行访问权限；邮箱不保存到本站账户数据库，本站不接收你的平台密码。</td></tr>
      <tr><td>告知版本、成年声明、核验状态和最小核验引用</td><td>记录确认和核验过程，控制通信权限。本站不收集身份证件照片。实际核验方式须另行与运营者约定。</td></tr>
      <tr><td>房间成员标识、消息、文件及文件名、大小、时间</td><td>向房间另一位参与者交付内容、展示记录并管理房间期限和容量。</td></tr>
      <tr><td>请求的 IP 摘要及必要安全、操作事件</td><td>限制滥用、核查权限变更、处理故障和安全事件。摘要仍可能关联个人，不将其宣称为匿名信息。</td></tr>
      <tr><td>投诉类别、描述、可选联系方式和房间关联、处理答复</td><td>处理投诉与个人信息权利请求。联系方式可留空；不主动把房间聊天和文件附到投诉中。</td></tr>
    </tbody></table></div>
    <p>浏览器会使用平台登录会话。邀请凭证放在网址片段中；登录跳转和账户页面间使用 sessionStorage 暂存邀请，返回首页后移除。旧版浏览器留下的成员编号仅用于申请删除旧房间。本站不为广告画像设置分析追踪。</p>
    <h3>谁能接触信息</h3>
    <p>房间内双方可读取彼此发送的内容。运营者可处理账户核验和投诉，后台默认不展示聊天正文或文件；维护程序处理保存和删除。服务使用 OpenAI Sites 及其 Cloudflare D1/R2 托管能力，相关平台可能为提供托管、存储和安全服务处理数据。本站通过 HTTPS 传输，由服务端中转，未提供端到端加密。</p>
    <p>当前未核实托管资源的具体国家或地区、平台备份和日志保存期限，以及必要的跨境处理安排。因此，本告知不代表已完成全部跨境合规程序。请勿传输患者资料、身份证件照片、金融账户信息或其他敏感资料。公开源码仓库只用于开发，不接收私人投诉或身份材料。</p>
    <h3>保存与删除</h3>
    <ul>
      <li>新版房间在创建 24 小时后关闭；任一参与者也可以提前删除房间。关闭后双方停止访问，消息和文件进入清理队列。</li>
      <li>清理任务按小时安排，先删除文件对象再删除相关元数据，失败会重试。调度可能延迟或停止，不能保证一个固定的物理删除时刻。维护异常时暂停创建新房间。</li>
      <li>2026-10-30 更新前的旧版内容由运营者执行明确的旧数据清理操作，不因发布新版本自动删除。</li>
      <li>核验业务记录在账户存续期间保存，注销时移除；核验批准最长有效期为 180 天。投诉内容在处理结束后保存 30 天，且自提交起最长保存 180 天。</li>
      <li>必要安全与操作记录单独保存 186 天，不包括聊天正文、附件、原始证件或投诉回执密钥。注销账户不提前清除此类依法需要保留的记录。</li>
    </ul>
    <p>应用层删除不等于抹除平台备份、平台安全日志或对方已下载的副本。平台层面的保存与删除范围尚待确认；可通过下方渠道提出相关查询。</p>
    <h3>你的选择与权利</h3>
    <p>你可以拒绝确认告知，此时仍可阅读本页、提交投诉及查询回执。你可在账户区域注销本站账户并撤回同意，关闭参与的房间并提出删除；也可对当前房间单独申请删除。查询、复制、更正、补充个人信息，或对处理提出解释和异议，可选择“隐私与个人信息权利”提交请求，或发送邮件联系运营者。运营者会按请求性质核实身份，避免把信息交给无权获得的人。</p>
    <p>退出登录只结束当前平台会话，不等于注销或删除。注销本站账户也不会注销 ChatGPT 账户。撤回同意不影响撤回前已经开展的处理；法律要求保留的事项按相应期限和限制处理。</p>
    <h3>投诉、更新与成年人限制</h3>
    <p>投诉后请保存私密回执，通过本页查看进度和答复；紧急安全事件可同时联系运营者邮箱。本项目的服务目标为提交后 7 个自然日内反馈受理情况或处理进展，紧急安全事件优先处理；复杂事项会说明延期原因。该目标是本站服务安排，不是对所有投诉适用的法定统一期限。页面状态表示实际处理进度，不代表自动完成处置。不要在投诉中粘贴完整证件、支付凭据或无关第三方信息。</p>
    <p>本站不面向未满 18 周岁者开放通信。发现未成年人使用或误收其信息时，可立即联系运营者处理。处理目的、类型或规则发生实质变化时，将更新告知版本并重新请求确认。当前版本：2026-10-30。</p>
  </section>;
}

function ComplaintForms({ room }: { room: string }) {
  const [category, setCategory] = useState("privacy"); const [details, setDetails] = useState("");
  const [contact, setContact] = useState(""); const [linkRoom, setLinkRoom] = useState(false);
  const [receipt, setReceipt] = useState(""); const [lookup, setLookup] = useState("");
  const [result, setResult] = useState<z.infer<typeof complaintResultSchema> | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = z.object({ receipt: z.string(), status: z.string(), created: z.number() }).parse(await requestJson("/api/complaints", { category, details, contact }, "POST", linkRoom && room ? { "x-room": room } : {}));
      setReceipt(response.receipt); setLookup(response.receipt); setDetails(""); setContact(""); setResult(null);
      setNotice("投诉已提交。请立即保存下方私密回执；刷新或关闭页面后将不再显示。");
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function query(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try { setResult(complaintResultSchema.parse(await requestJson("/api/complaints/status", { receipt: lookup.trim() }))); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return <section className="governance-card" id="complaints" aria-labelledby="complaint-title">
    <span className="eyebrow">PRIVATE SUPPORT</span><h2 id="complaint-title">投诉与个人信息权利请求</h2><p>无需登录即可提交。描述只供运营者处理，回执查询只返回进度与答复。请勿提交证件照片、账户密码或无关敏感信息。</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    {receipt && <div className="receipt-box"><strong>私密回执 · 请妥善保存</strong><p>持有回执的人可查看处理进度与答复。请勿发到公开仓库。</p><input aria-label="新投诉私密回执" readOnly value={receipt} onFocus={e => e.target.select()} /><button className="secondary" onClick={() => { void navigator.clipboard.writeText(receipt).then(() => setNotice("回执已复制，请保存到安全的位置。")).catch(() => setError("自动复制失败，请选中回执手动复制。")); }}>复制回执</button></div>}
    <form className="governance-form" onSubmit={submit}>
      <label>请求类别<select value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(categoryLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>说明情况<textarea required minLength={1} maxLength={2000} rows={5} value={details} onChange={e => setDetails(e.target.value)} placeholder="请说明需要核查的问题或希望行使的权利，不要粘贴敏感材料。" /><span className="field-hint">{details.length}/2000</span></label>
      <label>联系方式（选填）<input maxLength={254} value={contact} onChange={e => setContact(e.target.value)} placeholder="可留空，使用回执查看答复" /><span className="field-hint">用于就本次请求联系你；不会展示给其他用户。</span></label>
      {room && <label className="check-label"><input type="checkbox" checked={linkRoom} onChange={e => setLinkRoom(e.target.checked)} /><span>关联我刚才打开的房间（需具有该房间权限；不自动附带聊天内容）。</span></label>}
      <p className="field-hint">提交后，运营者将按<a className="inline-link" href="#privacy">隐私告知</a>处理请求内容和可选联系方式。</p>
      <button className="primary" disabled={busy || !details.trim()}>{busy ? "处理中…" : "提交并获取私密回执"}</button>
    </form>
    <form className="governance-form receipt-query" onSubmit={query}><h3>查询处理进度</h3><label>私密回执<input required autoComplete="off" spellCheck={false} value={lookup} onChange={e => setLookup(e.target.value)} maxLength={128} placeholder="粘贴提交时保存的回执" /></label><button className="secondary" disabled={busy || !lookup.trim()}>查询进度与答复</button></form>
    {result && <div className="notice-box" role="status"><strong>{statusLabels[result.status] || result.status}</strong><p className="pre-wrap">{result.reply || "运营者尚未回复，请稍后查询。"}</p><p className="field-hint">提交：{timeText(result.created)}<br />首次进展反馈目标：{timeText(result.created + 7 * 86400000)}<br />更新：{timeText(result.updated)}</p><p className="field-hint">以上是本站 7 个自然日的服务目标；复杂事项会说明延期原因。紧急情况可同时联系运营者邮箱。</p></div>}
  </section>;
}

function AccountReview({ item, busy, submit }: { item: Overview["accounts"][number]; busy: boolean; submit: (path: string, data: unknown) => Promise<void> }) {
  const [decision, setDecision] = useState("verified"); const [method, setMethod] = useState("document");
  const [reference, setReference] = useState(""); const [attested, setAttested] = useState(false);
  return <form className="review-item governance-form" onSubmit={e => { e.preventDefault(); void submit("/api/admin/verification", { accountId: item.id, decision, method, reference, attested }); }}>
    <h4 className="mono">{item.id}</h4><p className="field-hint">{verificationLabels[item.verification]} · 申请于 {timeText(item.requested)}<br />核验到期：{timeText(item.verified_until)}</p>
    <div className="form-columns"><label>处理决定<select value={decision} onChange={e => { setDecision(e.target.value); setAttested(false); }}><option value="verified">批准核验</option><option value="rejected">不予批准</option><option value="revoked">撤销核验</option></select></label>{decision === "verified" && <label>实际核验方式<select value={method} onChange={e => { setMethod(e.target.value); setAttested(false); }}><option value="document">核验有效身份证明</option><option value="verified_phone">已确认实名归属的手机号</option><option value="trusted_provider">可信服务商核验结果</option></select></label>}</div>
    <label>外部核验记录引用{decision === "verified" ? "（批准必填）" : "（选填）"}<input required={decision === "verified"} maxLength={120} value={reference} onChange={e => setReference(e.target.value)} placeholder="填不含个人信息的内部编号，勿填姓名、证件号或手机号" /></label>
    {decision === "verified" && <label className="check-label"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} /><span>我已实际核查所选方式的证据及其与该账户的关联，并确认不是仅凭自报姓名、平台登录或短信收码批准。</span></label>}
    <button className="secondary" disabled={busy || (decision === "verified" && (!reference.trim() || !attested))}>保存核验决定</button>
  </form>;
}

function ComplaintReview({ item, checkedAt, busy, submit }: { item: Overview["complaints"][number]; checkedAt: number; busy: boolean; submit: (path: string, data: unknown) => Promise<void> }) {
  const [status, setStatus] = useState("in_progress"); const [reply, setReply] = useState(item.reply); const [closeRoom, setCloseRoom] = useState(false);
  return <form className="review-item governance-form" onSubmit={e => { e.preventDefault(); if (closeRoom && !confirm("同时关闭并排队删除该投诉关联房间的双方消息与文件？")) return; void submit("/api/admin/complaints", { id: item.id, status, reply, closeRoom }); }}>
    {["received", "in_progress"].includes(item.status) && item.created + 7 * 86400000 < checkedAt && <p className="follow-up-flag">待跟进 · 已超过首次进展反馈目标，请核查进度并说明延期原因。</p>}
    <h4>{categoryLabels[item.category] || item.category} · {statusLabels[item.status] || item.status}</h4><p className="field-hint">{timeText(item.created)} · <span className="mono">{item.id}</span></p><p className="submission-copy pre-wrap">{item.details}</p><p className="field-hint">联系方式：{item.contact || "未提供，请通过私密回执答复"}</p>
    <label>处理状态<select value={status} onChange={e => setStatus(e.target.value)}><option value="in_progress">处理中</option><option value="resolved">已处理</option><option value="rejected">不予受理</option></select></label>
    <label>私密答复<textarea required maxLength={2000} rows={3} value={reply} onChange={e => setReply(e.target.value)} placeholder="说明已核查和已采取的措施；勿把其他人的信息写入答复。" /></label>
    {item.hasRoom && <label className="check-label"><input type="checkbox" checked={closeRoom} onChange={e => setCloseRoom(e.target.checked)} /><span>同时关闭并排队删除关联房间。</span></label>}
    <button className="secondary" disabled={busy || !reply.trim()}>保存处理结果</button>
  </form>;
}

function AdminPanel({ account, refreshAccount }: { account: Account; refreshAccount: () => Promise<void> }) {
  const [overview, setOverview] = useState<Overview | null>(null); const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const [accountQuery, setAccountQuery] = useState(""); const [complaintQuery, setComplaintQuery] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async (accountId = accountQuery, complaintId = complaintQuery) => {
    const query = new URLSearchParams();
    if (accountId.trim()) query.set("accountId", accountId.trim());
    if (complaintId.trim()) query.set("complaintId", complaintId.trim());
    setOverview(overviewSchema.parse(await requestJson(`/api/admin/overview${query.size ? `?${query}` : ""}`, undefined, "GET")));
    setCheckedAt(Date.now());
  }, [accountQuery, complaintQuery]);
  useEffect(() => { let active = true; void requestJson("/api/admin/overview", undefined, "GET").then(value => { if (active) { setOverview(overviewSchema.parse(value)); setCheckedAt(Date.now()); } }).catch(e => { if (active) setError(messageOf(e)); }); return () => { active = false; }; }, []);
  async function submit(path: string, data: unknown) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await requestJson(path, data);
      await load(); await refreshAccount();
      if (path === "/api/admin/cleanup") {
        const result = z.object({ deletedRooms: z.number(), failedRooms: z.number(), pendingUploads: z.number(), more: z.boolean() }).parse(response);
        setNotice(`本批已清理 ${result.deletedRooms} 个房间，失败 ${result.failedRooms} 个，待处理上传 ${result.pendingUploads} 个。${result.more ? "仍有待处理项目，可再次运行清理。" : "本批检查完成。"}`);
      } else setNotice(path === "/api/admin/legacy-cleanup" ? "过期旧版房间已进入删除队列，请查看清理结果。" : "处理结果已保存。");
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  return <section className="governance-card" id="admin" aria-labelledby="admin-title"><span className="eyebrow">OPERATOR CONSOLE</span><h2 id="admin-title">运营者工作台</h2><p>仅授权运营者可访问。这里处理核验、私密投诉和清理任务，不展示聊天正文或附件。</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    <form className="governance-form" onSubmit={e => { e.preventDefault(); setError(""); setBusy(true); void load().catch(error => setError(messageOf(error))).finally(() => setBusy(false)); }}><div className="form-columns"><label>精确查找账户（选填）<input maxLength={200} autoComplete="off" spellCheck={false} value={accountQuery} onChange={e => setAccountQuery(e.target.value)} placeholder="完整账户引用" /></label><label>精确查找投诉（选填）<input maxLength={36} autoComplete="off" spellCheck={false} value={complaintQuery} onChange={e => setComplaintQuery(e.target.value)} placeholder="完整投诉 ID，不是私密回执" /></label></div><p className="field-hint">默认列表有数量限制。较早记录可通过完整标识查找；查询条件仅发往受保护接口，不写入当前页面地址。</p><div className="action-row"><button className="secondary" disabled={busy}>查找记录</button><button type="button" className="secondary" disabled={busy} onClick={() => { setAccountQuery(""); setComplaintQuery(""); setError(""); setBusy(true); void load("", "").catch(error => setError(messageOf(error))).finally(() => setBusy(false)); }}>清空查询</button></div></form>
    <div className="action-row"><button className="secondary" disabled={busy} onClick={() => { setError(""); void load().catch(e => setError(messageOf(e))); }}>刷新工作台</button><button className="primary" disabled={busy} onClick={() => void submit("/api/admin/cleanup", {})}>运行一批清理</button></div>
    {!overview ? <p>尚未载入工作台数据。</p> : <>
      <div className="maintenance-summary"><strong>{account.maintenanceHealthy ? "维护状态正常" : "维护异常：新建房间已暂停"}</strong><dl className="account-facts"><div><dt>最近运行</dt><dd>{timeText(overview.lastMaintenance?.last_run ?? null)}</dd></div><div><dt>最近成功</dt><dd>{timeText(overview.lastMaintenance?.last_success ?? null)}</dd></div><div><dt>失败计数</dt><dd>{overview.lastMaintenance?.failures ?? 0}</dd></div><div><dt>房间</dt><dd>活跃 {overview.counts.active} · 待清理 {overview.counts.queued} · 旧版 {overview.counts.legacy}</dd></div></dl><p>GitHub Actions 按每小时第 17 分钟安排清理，可能延迟；公开仓库长期无活动时计划任务可能被平台暂停。最近 3 小时没有成功维护将暂停新建房间。请核查工作流状态、配置和运行结果，必要时在此重试。</p></div>
      <details className="legacy-cleanup"><summary>处理更新前遗留的过期房间</summary><p>仅将已过期的旧版房间加入删除队列。此操作不会恢复访问，也不会删除尚未过期的旧版房间。清理后的内容无法从应用恢复。</p><button className="danger-text" disabled={busy} onClick={() => { if (confirm("确认将更新前所有已过期的旧版房间及双方内容加入删除队列？这是实际的数据清理请求，无法撤销。")) void submit("/api/admin/legacy-cleanup", { confirm: true }); }}>确认排队清理过期旧数据</button></details>
      <h3>身份核验申请与记录</h3><p className="field-hint">批准前需要真实证据。短信验证码或 ChatGPT 账户本身不等于完成法定实名核验。核验记录只填写可追溯引用，不保存原始证件。</p>{overview.accounts.length ? overview.accounts.map(item => <AccountReview key={`${item.id}-${item.reviewed}-${item.verification}`} item={item} busy={busy} submit={submit} />) : <p>暂无待处理账户。</p>}
      <h3>私密投诉</h3>{overview.complaints.length ? overview.complaints.map(item => <ComplaintReview key={`${item.id}-${item.updated}`} item={item} checkedAt={checkedAt} busy={busy} submit={submit} />) : <p>暂无投诉记录。</p>}
    </>}
  </section>;
}

export default function GovernancePage() {
  const [account, setAccount] = useState<Account | null>(null); const [error, setError] = useState(""); const [room, setRoom] = useState("");
  const refresh = useCallback(async () => { setAccount(accountSchema.parse(await requestJson("/api/account", undefined, "GET"))); }, []);
  // Restore the browser-held room only after hydration; it never enters the URL query.
  useEffect(() => {
    let active = true;
    void requestJson("/api/account", undefined, "GET").then(value => { if (active) setAccount(accountSchema.parse(value)); }).catch(e => { if (active) setError(messageOf(e)); });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the external browser value after hydration.
    try { const value = sessionStorage.getItem("between-return-invite") || ""; if (/^[a-f0-9]{64}$/.test(value)) setRoom(value); }
    catch { setError("浏览器无法读取暂存的房间。仍可提交普通投诉，请不要在描述中附带完整邀请链接。"); }
    return () => { active = false; };
  }, []);
  return <main className="shell governance-shell"><header className="topbar"><a className="brand" href="/" aria-label="返回 Between"><span className="brand-mark"><i /><i /></span><span>between<span className="brand-period">.</span></span></a><a className="secondary action-link" href="/">返回会话</a></header><div className="governance-heading"><span className="eyebrow">ACCOUNT · PRIVACY · SUPPORT</span><h1>你的账户，与你的信息。</h1><p>了解信息如何处理，申请核验，或提出需要解决的问题。</p></div><nav className="governance-nav" aria-label="治理页面分区"><a href="#account">账户与核验</a><a href="#privacy">隐私告知</a><a href="#complaints">投诉与查询</a>{account?.admin && <a href="#admin">运营者工作台</a>}</nav>
    {error && <div className="form-error" role="alert">{error}<button className="text-button" onClick={() => { setError(""); void refresh().catch(e => setError(messageOf(e))); }}>重试读取账户</button></div>}
    <AccountPanel account={account} refresh={refresh} /><PrivacyNotice /><ComplaintForms room={room} />{account?.admin && <AdminPanel account={account} refreshAccount={refresh} />}
    <footer className="footer"><span>BETWEEN · 账户与隐私</span><a className="inline-link" href="mailto:glah1005@163.com">联系运营者：glah1005@163.com</a><a href="/">返回会话</a></footer></main>;
}
