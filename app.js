import { createClient } from "https://esm.sh/genlayer-js@2.2.0";
import { studionet } from "https://esm.sh/genlayer-js@2.2.0/chains";
import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const ZERO = "0x0000000000000000000000000000000000000000";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gen = (wei) => { try { const n = Number(BigInt(wei || "0")) / 1e18; return (Math.round(n * 1000) / 1000).toString(); } catch { return "0"; } };
const ago = (t) => { const s = Math.floor(Date.now() / 1000) - Number(t || 0); if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago"; };
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }

const state = {
  net: store("hp_net") === "live" ? "live" : "demo",
  account: null,
  provider: null,
  client: null,
  readClient: createClient({ chain: studionet }),
  cfg: null,
  companies: [],
  jobs: [],
  reports: [],
  checks: [],
};
const addr = () => CONFIG[state.net].address;

// ---------------------------------------------------------------- toasts
function toast(msg, kind = "", ms = 5000) {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.innerHTML = msg;
  $("toasts").appendChild(t);
  if (ms) setTimeout(() => t.remove(), ms);
  return t;
}

// ---------------------------------------------------------------- tabs
function showTab(name) {
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("on", p.id === "tab-" + name));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  history.replaceState(null, "", "#" + name);
  window.scrollTo({ top: 0 });
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); showTab(b.dataset.tab); }));
const startTab = location.hash.replace("#", "");
if (startTab && $("tab-" + startTab)) showTab(startTab);

// ---------------------------------------------------------------- network switch
function paintNet() {
  document.querySelectorAll("#netswitch button").forEach((b) => b.classList.toggle("on", b.dataset.net === state.net));
}
document.querySelectorAll("#netswitch button").forEach((b) => b.addEventListener("click", () => {
  state.net = b.dataset.net; store("hp_net", state.net); paintNet(); refresh();
}));
paintNet();

// ---------------------------------------------------------------- wallet (EIP-6963 list)
const found = new Map();
window.addEventListener("eip6963:announceProvider", (e) => { const d = e.detail; if (d?.info?.uuid) found.set(d.info.uuid, d); });
window.dispatchEvent(new Event("eip6963:requestProvider"));

function openWalletModal() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const box = $("walletChoices");
  box.innerHTML = "";
  const list = [...found.values()];
  if (!list.length && window.ethereum) list.push({ info: { name: "Browser wallet", icon: "" }, provider: window.ethereum });
  if (!list.length) { box.innerHTML = '<p class="hint">No wallet found. Install Rabby or MetaMask.</p>'; }
  list.forEach((w) => {
    const b = document.createElement("button");
    b.className = "wchoice";
    b.innerHTML = (w.info.icon ? `<img src="${esc(w.info.icon)}" alt="">` : "") + esc(w.info.name);
    b.onclick = () => { $("walletModal").hidden = true; connect(w.provider); };
    box.appendChild(b);
  });
  $("walletModal").hidden = false;
}
$("closeModal").onclick = () => ($("walletModal").hidden = true);
$("connectBtn").onclick = () => (state.account ? null : openWalletModal());

async function ensureChain(p) {
  const hex = "0x" + studionet.id.toString(16);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if (e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || "")) {
      await p.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex,
          chainName: studionet.name || "GenLayer Studio",
          rpcUrls: studionet.rpcUrls.default.http,
          nativeCurrency: studionet.nativeCurrency,
        }],
      });
    } else throw e;
  }
}

async function connect(p) {
  try {
    const accs = await p.request({ method: "eth_requestAccounts" });
    await ensureChain(p);
    state.provider = p;
    state.account = accs[0].toLowerCase();
    state.client = createClient({ chain: studionet, account: accs[0], provider: p });
    $("connectBtn").textContent = short(state.account);
    p.on?.("accountsChanged", (a) => { state.account = a[0]?.toLowerCase() || null; $("connectBtn").textContent = state.account ? short(state.account) : "Connect wallet"; if (state.account) state.client = createClient({ chain: studionet, account: a[0], provider: p }); paintMine(); });
    toast("Wallet connected", "ok");
    paintMine();
  } catch (e) {
    toast("Wallet error: " + esc(e?.message || e), "err");
  }
}

// ---------------------------------------------------------------- contract calls
function ready() {
  if (!addr() || addr() === ZERO) { toast("The " + CONFIG[state.net].label + " contract address is not set yet.", "err"); return false; }
  return true;
}
async function read(fn, args = []) {
  const r = await state.readClient.readContract({ address: addr(), functionName: fn, args });
  return typeof r === "string" ? r : String(r ?? "");
}
async function readJSON(fn, args = [], fallback = []) {
  try { const s = await read(fn, args); return s ? JSON.parse(s) : fallback; } catch (e) { console.warn(fn, e); return fallback; }
}

// Studio charges a fee on every write: quote it, then send it with the call.
async function quoteFees(call) {
  let q;
  try {
    q = await state.client.estimateTransactionFeesForWrite(call);
  } catch (e) {
    console.warn("fee simulation failed, using the default preset", e);
    q = await state.client.estimateTransactionFees();
  }
  return { distribution: q.distribution, messageAllocations: q.messageAllocations, feeValue: q.feeValue };
}

async function write(fn, args, valueWei, label, btn) {
  if (!ready()) return false;
  if (!state.client) { openWalletModal(); return false; }
  const t = toast(`<span class="spin"></span>${esc(label)} — calculating the network fee…`, "", 0);
  if (btn) btn.disabled = true;
  try {
    await ensureChain(state.provider);
    const call = { address: addr(), functionName: fn, args, value: valueWei || 0n };
    const fees = await quoteFees(call);
    t.innerHTML = `<span class="spin"></span>${esc(label)} — confirm in your wallet…`;
    const hash = await state.client.writeContract({ ...call, fees });
    t.innerHTML = `<span class="spin"></span>${esc(label)} — validators are working (can take 1–3 min)…`;
    const receipt = await state.readClient.waitForTransactionReceipt({ hash, status: "ACCEPTED", interval: 4000, retries: 120 });
    const final = String(receipt?.statusName || receipt?.status_name || "").toUpperCase();
    if (final && final !== "ACCEPTED" && final !== "FINALIZED") {
      throw new Error("Validators did not agree (" + final + "). Nothing changed - please try again.");
    }
    const lr = receipt?.consensus_data?.leader_receipt;
    const r0 = Array.isArray(lr) ? lr[0] : lr;
    if (r0 && String(r0.execution_result || "").toUpperCase() === "ERROR") {
      const why = r0?.result?.payload?.readable || r0?.genvm_result?.stderr || "The contract rejected this action.";
      throw new Error(String(why).slice(0, 220));
    }
    t.remove();
    toast(esc(label) + " — done ✓", "ok");
    await refresh();
    return true;
  } catch (e) {
    t.remove();
    toast(esc(label) + " failed: " + esc(e?.shortMessage || e?.message || e), "err", 9000);
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------- rendering
const statusBadge = (s) => {
  const m = { VERIFIED: "b-green", DOMAIN_MATCH_ONLY: "b-blue", INDETERMINATE: "b-gray", NOT_CHECKED: "b-gray", LIVE: "b-green", UPHELD: "b-red", FLAGGED: "b-red", SCAM: "b-red", REJECTED: "b-gray", DISMISSED: "b-gray", CLOSED: "b-gray", PENDING: "b-amber", OPEN: "b-amber", EXITING: "b-amber", SUSPICIOUS: "b-amber", NO_RED_FLAGS: "b-blue" };
  return `<span class="badge ${m[s] || "b-gray"}">${esc(String(s).replace(/_/g, " "))}</span>`;
};
const VERDICT_TEXT = {
  SCAM: ["🚫 Scam", "Do not pay anything and do not share OTP, bank or ID details."],
  SUSPICIOUS: ["⚠️ Suspicious", "Confirm this job on the company's official website before you reply."],
  DOMAIN_MATCH_ONLY: ["Domain match only — sender not authenticated", "The address you typed uses a verified company's domain and no scam signs were found. This does not prove who sent the message. Confirm on the company's official website."],
  NO_RED_FLAGS: ["No red flags found", "No scam signs were found, but the sender is not authenticated. Never pay to get a job."],
  INDETERMINATE: ["No verdict — please try again", "Validators could not analyse this message. This is not a safe result."],
};

function paintStats() {
  const c = state.cfg || {};
  $("st-companies").textContent = state.companies.filter((x) => x.status === "VERIFIED" || x.status === "EXITING").length;
  $("st-jobs").textContent = state.jobs.filter((j) => j.status === "LIVE").length;
  $("st-checks").textContent = c.checks ?? "–";
  $("st-scams").textContent = c.scams ?? "–";
  $("rp-bond").textContent = "Bond: " + gen(c.report_bond) + " GEN";
  $("rg-stake").textContent = "Stake: " + gen(c.min_stake) + " GEN (returned when you exit, unless the Scam Court flags you)";
  const win = Number(c.window || 0);
  $("contractInfo").innerHTML = `Network: <b>${esc(CONFIG[state.net].label)}</b> · contract <code>${esc(short(addr()))}</code><br>${esc(CONFIG[state.net].note)}${win ? " · court window " + (win >= 3600 ? win / 3600 + " h" : win / 60 + " min") : ""}`;
  const dl = $("domainList");
  dl.innerHTML = state.companies.filter((x) => x.status === "VERIFIED").map((x) => `<option value="${esc(x.domain)}">${esc(x.name)}</option>`).join("");
}

function checkCard(k, big = false) {
  const [title, sub] = VERDICT_TEXT[k.verdict] || [k.verdict, ""];
  const items = [...(k.signals || []), ...(k.red_flags || [])];
  if (big) {
    return `<div class="verdict v-${esc(k.verdict)}"><h3>${esc(title)}</h3><p>${esc(sub)}</p>
      ${k.summary ? `<p><b>Validators:</b> ${esc(k.summary)}</p>` : ""}
      <ul>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="meta">Check ${esc(k.id)} · saved on-chain ${ago(k.at)}</p></div>`;
  }
  return `<div class="item"><div class="item-h"><h4>${statusBadge(k.verdict)} ${esc(k.claimed || "Unknown company")}</h4><span class="meta">${esc(k.id)} · ${ago(k.at)}</span></div>
    <p class="meta" style="margin:6px 0">${esc((k.snippet || "").slice(0, 180))}${(k.snippet || "").length > 180 ? "…" : ""}</p>
    ${items.length ? `<p style="margin:0;font-size:13px">${esc(items[0])}</p>` : ""}</div>`;
}

function paintChecks() {
  $("checkList").innerHTML = state.checks.length ? state.checks.slice(0, 12).map((k) => checkCard(k)).join("") : '<p class="empty">No offers checked yet. Be the first.</p>';
}

function paintJobs() {
  const q = $("jobSearch").value.trim().toLowerCase();
  const byId = Object.fromEntries(state.companies.map((c) => [c.id, c]));
  const list = state.jobs.filter((j) => j.status === "LIVE").filter((j) => !q || (j.title + j.company + j.location).toLowerCase().includes(q));
  $("jobList").innerHTML = list.length ? list.map((j) => {
    const exiting = byId[j.company_id]?.status === "EXITING";
    return `<div class="item job">
      <div class="co"><span class="badge b-green">✓ Verified</span> ${esc(j.company)} · ${esc(j.domain)}</div>
      <h4>${esc(j.title)}</h4>
      <div class="tags">${j.location ? `<span class="tag">📍 ${esc(j.location)}</span>` : ""}${j.salary ? `<span class="tag">💰 ${esc(j.salary)}</span>` : ""}<span class="tag">No fees · checked by validators</span>${exiting ? '<span class="tag">Company is leaving HireProof</span>' : ""}</div>
      <div class="actions"><a class="btn btn-ghost btn-sm" href="${esc(j.url)}" target="_blank" rel="noopener">Open official page ↗</a><span class="meta">${esc(j.id)} · ${ago(j.posted_at)}</span></div>
    </div>`;
  }).join("") : '<p class="empty">No verified jobs yet.</p>';
}
$("jobSearch").addEventListener("input", paintJobs);

function companyRow(c, mine = false) {
  const live = state.jobs.filter((j) => j.company_id === c.id && j.status === "LIVE").length;
  let acts = "";
  if (mine) {
    if (c.status === "PENDING") acts += `<button class="btn btn-primary btn-sm" data-act="verify" data-id="${c.id}">Verify domain</button><button class="btn btn-ghost btn-sm" data-act="exit" data-id="${c.id}">Cancel &amp; refund</button>`;
    if (c.status === "VERIFIED") acts += `<button class="btn btn-ghost btn-sm" data-act="exit" data-id="${c.id}">Request exit</button>`;
    if (c.status === "EXITING") acts += `<button class="btn btn-ghost btn-sm" data-act="final" data-id="${c.id}">Finish exit${Number(c.exit_at) > Date.now() / 1000 ? " (after " + new Date(c.exit_at * 1000).toLocaleTimeString() + ")" : ""}</button>`;
    state.jobs.filter((j) => j.company_id === c.id && j.status === "LIVE").forEach((j) => { acts += `<button class="btn btn-ghost btn-sm" data-act="closejob" data-id="${j.id}">Close “${esc(j.title)}”</button>`; });
  }
  return `<div class="item"><div class="item-h"><h4>${esc(c.name)} <span class="meta">· ${esc(c.domain)}</span></h4>${statusBadge(c.status)}</div>
    <p class="meta" style="margin:6px 0 0">${esc(c.id)} · stake ${gen(c.stake)} GEN · ${live} live job${live === 1 ? "" : "s"}${c.note ? " · " + esc(c.note) : ""}</p>
    ${acts ? `<div class="actions">${acts}</div>` : ""}</div>`;
}

function paintCompanies() {
  $("companyList").innerHTML = state.companies.length ? state.companies.map((c) => companyRow(c)).join("") : '<p class="empty">No companies registered yet.</p>';
  const opts = state.companies.filter((c) => (c.status === "VERIFIED" || c.status === "EXITING") && !c.open_report);
  $("rp-company").innerHTML = opts.length ? opts.map((c) => `<option value="${c.id}">${esc(c.name)} — ${esc(c.domain)}</option>`).join("") : '<option value="">No reportable companies</option>';
}

function paintReports() {
  const now = Date.now() / 1000;
  $("reportList").innerHTML = state.reports.length ? state.reports.map((r) => {
    const company = state.companies.find((c) => c.id === r.company_id) || {};
    const isCo = state.account && company.owner === state.account;
    const left = Number(r.deadline) - now;
    let acts = "";
    if (r.status === "OPEN") {
      if (isCo && !r.response && left > 0) acts += `<textarea id="resp-${r.id}" rows="2" placeholder="Your response to the court"></textarea><button class="btn btn-primary btn-sm" data-act="respond" data-id="${r.id}">Send response</button>`;
      if (r.response || left <= 0) acts += `<button class="btn btn-danger btn-sm" data-act="resolve" data-id="${r.id}">Ask validators to rule</button>`;
      if (now > Number(r.deadline) + 7 * Number(state.cfg?.window || Infinity)) acts += `<button class="btn btn-ghost btn-sm" data-act="expire" data-id="${r.id}">Close without decision (refund bond)</button>`;
    }
    return `<div class="item"><div class="item-h"><h4>${esc(r.id)} · ${esc(r.company)} <span class="meta">${esc(r.domain)}</span></h4>${statusBadge(r.status)}</div>
      ${r.quote ? `<div class="quote">“${esc(r.quote)}”</div>` : ""}
      ${r.details ? `<p class="meta" style="margin:4px 0">Reporter: ${esc(r.details)}</p>` : ""}
      ${r.context ? `<details><summary class="meta">Stored source text confirmed by validators</summary><p class="meta">${esc(r.context)}</p></details>` : ""}
      ${r.response ? `<div class="resp"><b>Company:</b> ${esc(r.response)}</div>` : ""}
      ${r.ruling ? `<p style="margin:6px 0 0;font-size:14px"><b>Court:</b> ${esc(r.ruling)}</p>` : ""}
      <p class="meta" style="margin:6px 0 0"><a href="${esc(r.evidence_url)}" target="_blank" rel="noopener">evidence ↗</a> · bond ${gen(r.bond)} GEN · ${r.status === "OPEN" ? (left > 0 ? "response window ends in " + Math.ceil(left / 60) + " min" : "window over") : ago(r.resolved_at)}</p>
      ${acts ? `<div class="actions" style="flex-direction:column;align-items:stretch">${acts}</div>` : ""}</div>`;
  }).join("") : '<p class="empty">No cases yet.</p>';
}

async function paintMine() {
  const me = state.account;
  $("proofLine").textContent = me ? "hireproof-owner=" + me : "Connect your wallet to see your proof line";
  const mine = me ? state.companies.filter((c) => c.owner === me) : [];
  $("myCompanies").innerHTML = !me ? '<p class="empty">Connect your wallet.</p>' : mine.length ? mine.map((c) => companyRow(c, true)).join("") : '<p class="empty">You have not registered a company yet.</p>';
  const ver = mine.filter((c) => c.status === "VERIFIED");
  $("jb-company").innerHTML = ver.length ? ver.map((c) => `<option value="${c.id}">${esc(c.name)} — ${esc(c.domain)}</option>`).join("") : '<option value="">Verify a company first</option>';
  paintReports();
  if (me && addr() !== ZERO) {
    try { $("credit").textContent = gen(await read("get_credit", [me])) + " GEN"; } catch { $("credit").textContent = "–"; }
  } else $("credit").textContent = "–";
}

async function refresh() {
  if (!addr() || addr() === ZERO) {
    ["checkList", "jobList", "companyList", "reportList"].forEach((id) => ($(id).innerHTML = `<p class="empty">The ${esc(CONFIG[state.net].label)} contract address is not set yet (config.js).</p>`));
    paintStats(); return;
  }
  const [cfg, companies, jobs, reports, checks] = await Promise.all([
    readJSON("get_config", [], null), readJSON("list_companies", [100]), readJSON("list_jobs", [100]), readJSON("list_reports", [50]), readJSON("list_checks", [30]),
  ]);
  Object.assign(state, { cfg, companies, jobs, reports, checks });
  paintStats(); paintChecks(); paintJobs(); paintCompanies(); paintReports(); paintMine();
}

// ---------------------------------------------------------------- actions
$("checkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("ck-text").value.trim();
  if (text.length < 20) return toast("Paste the full offer message.", "err");
  const before = Number(state.cfg?.checks || 0);
  const ok = await write("check_offer", [text, $("ck-email").value.trim(), $("ck-domain").value.trim()], 0n, "Checking offer", e.submitter);
  if (ok) {
    const k = state.checks.find((x) => Number(x.id.slice(1)) > before && x.by === state.account) || state.checks[0];
    if (k) { $("checkResult").innerHTML = checkCard(k, true); $("checkResult").scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
});

$("regForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("rg-name").value.trim(), domain = $("rg-domain").value.trim();
  if (!name || !domain) return toast("Enter company name and domain.", "err");
  await write("register_company", [name, domain], BigInt(state.cfg?.min_stake || "0"), "Registering company", e.submitter);
});

$("jobForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cid = $("jb-company").value;
  if (!cid) return toast("Verify a company first.", "err");
  const ok = await write("post_job", [cid, $("jb-title").value.trim(), $("jb-loc").value.trim(), $("jb-sal").value.trim(), $("jb-url").value.trim()], 0n, "Validators checking your job page", e.submitter);
  if (ok) {
    const j = state.jobs[0];
    if (j) toast(j.status === "LIVE" ? "Job is LIVE ✓" : (j.status === "NOT_CHECKED" ? "Not checked: " : "Job rejected: ") + esc(j.note), j.status === "LIVE" ? "ok" : "err", 9000);
  }
});

$("reportForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cid = $("rp-company").value;
  if (!cid) return toast("Choose a verified company.", "err");
  const ok = await write("open_report", [cid, $("rp-url").value.trim(), $("rp-details").value.trim()], BigInt(state.cfg?.report_bond || "0"), "Validators checking the evidence", e.submitter);
  if (ok && state.reports[0]) toast("Report " + esc(state.reports[0].id) + ": " + esc(state.reports[0].status) + " — " + esc(state.reports[0].ruling), state.reports[0].status === "OPEN" ? "ok" : "err", 9000);
});

document.body.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (act === "verify") {
    const ok = await write("verify_company", [id], 0n, "Validators reading your hireproof.txt", b);
    const c = state.companies.find((x) => x.id === id);
    if (ok && c) toast(c.status === "VERIFIED" ? "Company VERIFIED ✓" : esc(c.note), c.status === "VERIFIED" ? "ok" : "err", 9000);
  }
  if (act === "exit") await write("request_exit", [id], 0n, "Requesting exit", b);
  if (act === "final") await write("finalize_exit", [id], 0n, "Finishing exit", b);
  if (act === "closejob") await write("close_job", [id], 0n, "Closing job", b);
  if (act === "respond") {
    const txt = $("resp-" + id)?.value.trim() || "";
    if (txt.length < 10) return toast("Write a response (at least 10 characters).", "err");
    await write("respond_report", [id, txt], 0n, "Sending response", b);
  }
  if (act === "expire") await write("expire_report", [id], 0n, "Closing case", b);
  if (act === "resolve") await write("resolve_report", [id], 0n, "Validators ruling", b);
});

$("lk-btn").onclick = async () => {
  const d = $("lk-domain").value.trim();
  if (!d || !ready()) return;
  const s = await read("lookup_domain", [d]).catch(() => "");
  $("lk-out").innerHTML = s ? companyRow(JSON.parse(s)) : `<div class="item"><h4>${statusBadge("SUSPICIOUS")} ${esc(d)} is not verified on HireProof</h4><p class="meta">That does not prove it is fake — but never pay anyone to get a job.</p></div>`;
};

$("copyProof").onclick = () => { navigator.clipboard?.writeText($("proofLine").textContent); toast("Copied", "ok", 2000); };
$("withdrawBtn").onclick = (e) => write("withdraw", [], 0n, "Withdrawing", e.currentTarget);

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
