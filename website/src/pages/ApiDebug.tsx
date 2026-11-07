import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Play, Radio } from "lucide-react";
import { useStore } from "../store/AppStore";
import type { HttpResult } from "../device/http/client";
import { textOf } from "../device/http/codec";
import { ago } from "../domain/time";
import { Banner, Card, CardHeader, PageHeader } from "../ui/Primitives";

interface Op { method: string; path: string; summary?: string; body?: unknown }
interface Spec { paths: Record<string, Record<string, { summary?: string; requestBody?: { content?: Record<string, { schema?: unknown }> } }>> }

const METHOD_TONE: Record<string, string> = { GET: "#059669", POST: "#2563eb", PUT: "#d97706", PATCH: "#7c3aed", DELETE: "#dc2626" };

/** 设备 API 调试页：读 public/openapi.json（由 scripts/openapi-bundle.mjs 生成），经隧道客户端发原始 HTTP 请求 */
export function ApiDebugPage() {
  const { api, device } = useStore();
  const [ops, setOps] = useState<Op[]>([]);
  const [sel, setSel] = useState<Op | undefined>();
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [schema, setSchema] = useState<unknown>();
  const [res, setRes] = useState<HttpResult | undefined>();
  const [err, setErr] = useState("");
  const [log, setLog] = useState<{ at: number; method: string; path: string; status: number; ms: number }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}openapi.json`).then((r) => r.json()).then((spec: Spec) => {
      const list: Op[] = [];
      for (const [path, methods] of Object.entries(spec.paths))
        for (const [method, o] of Object.entries(methods))
          list.push({ method: method.toUpperCase(), path, summary: o.summary, body: o.requestBody?.content?.["application/json"]?.schema });
      setOps(list);
    }).catch(() => {});
  }, []);

  const connected = device.state === "connected" && api;
  const pathParams = useMemo(() => (sel?.path.match(/\{(\w+)\}/g) ?? []).map((x) => x.slice(1, -1)), [sel]);
  const finalPath = sel ? pathParams.reduce((p, k) => p.replace(`{${k}}`, encodeURIComponent(params[k] ?? "")), sel.path) : "";

  const pick = (op: Op) => {
    setSel(op); setRes(undefined); setErr("");
    setParams({});
    setSchema(op.body);
    setBody(op.body ? "{}" : "");
  };

  const send = async () => {
    if (!api || !sel) return;
    setBusy(true); setErr(""); setRes(undefined);
    try {
      const opts: { json?: unknown } = {};
      if (body.trim()) opts.json = JSON.parse(body);
      const r = await api.http.raw(sel.method, finalPath, opts);
      setRes(r);
      setLog((l) => [{ at: Date.now(), method: sel.method, path: finalPath, status: r.status, ms: r.ms }, ...l].slice(0, 30));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const bodyText = res ? (res.headers["content-type"]?.startsWith("application/json") || res.headers["content-type"]?.startsWith("text/") ? textOf(res.body) : `<二进制 ${res.body.length} B>`) : "";

  return (
    <>
      <PageHeader title="设备 API 调试" desc="接口定义与 doc/http-api/openapi/ 同步；请求经 BLE/串口隧道直达设备。" />
      {!connected && <Banner tone="warn" icon={<Radio />}>设备未连接——先到「我的设备」连上收工牌，这里的请求才能送达。</Banner>}
      <div className="cols">
        <Card>
          <CardHeader icon={<FlaskConical />} title={`接口（${ops.length}）`} />
          <div className="card-b" style={{ maxHeight: 560, overflow: "auto" }}>
            <table className="tbl">
              <tbody>
                {ops.map((o, i) => (
                  <tr key={i} onClick={() => pick(o)} style={{ cursor: "pointer", background: sel === o ? "var(--bg-soft, #f3f4f6)" : undefined }}>
                    <td style={{ width: 62 }}><span className="badge" style={{ color: METHOD_TONE[o.method], borderColor: METHOD_TONE[o.method] }}>{o.method}</span></td>
                    <td><code>{o.path}</code>{o.summary && <div className="hint">{o.summary}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="stack">
          <Card>
            <CardHeader title={sel ? `${sel.method} ${sel.path}` : "选择一个接口"} extra={sel?.summary ? <span className="hint">{sel.summary}</span> : undefined} />
            <div className="card-b form">
              {!sel && <p className="hint" style={{ margin: 0 }}>左侧列出 openapi.json 里的全部操作。带 {"{参数}"} 的路径先填参数；JSON 报文体在下方编辑（schema 参考一并给出）。</p>}
              {sel && (
                <>
                  {pathParams.map((k) => (
                    <div className="row" key={k}>
                      <span className="hint" style={{ width: 90 }}>{`{${k}}`}</span>
                      <input className="input input-sm" value={params[k] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))} placeholder={k} />
                    </div>
                  ))}
                  {sel.body !== undefined && (
                    <>
                      <div className="hint">请求体（JSON）</div>
                      <textarea className="input" rows={5} style={{ fontFamily: "ui-monospace, monospace" }} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
                      {!!schema && <details className="hint"><summary>schema</summary><pre style={{ maxHeight: 160, overflow: "auto" }}>{JSON.stringify(schema, null, 1)}</pre></details>}
                    </>
                  )}
                  <div className="row">
                    <button className="btn btn-primary" disabled={!connected || busy || pathParams.some((k) => !params[k])} onClick={send}>
                      <Play />发送 <code style={{ marginLeft: 6 }}>{sel.method} {finalPath}</code>
                    </button>
                  </div>
                  {err && <Banner tone="warn">{err}</Banner>}
                  {res && (
                    <div className="code-box">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <b style={{ color: res.status < 400 ? "#059669" : "#dc2626" }}>HTTP {res.status}</b>
                        <span className="hint">{res.ms} ms · {res.body.length} B</span>
                      </div>
                      <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{bodyText || "（空报文体）"}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
          {!!log.length && (
            <Card>
              <CardHeader title="最近请求" />
              <div className="card-b">
                <table className="tbl">
                  <tbody>
                    {log.map((l, i) => (
                      <tr key={i}>
                        <td style={{ width: 60 }}><span className="badge" style={{ color: METHOD_TONE[l.method], borderColor: METHOD_TONE[l.method] }}>{l.method}</span></td>
                        <td><code>{l.path}</code></td>
                        <td style={{ width: 50, color: l.status < 400 ? "#059669" : "#dc2626" }}>{l.status || "—"}</td>
                        <td style={{ width: 70 }} className="hint">{l.ms}ms</td>
                        <td style={{ width: 70 }} className="hint">{ago(l.at, Date.now())}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
