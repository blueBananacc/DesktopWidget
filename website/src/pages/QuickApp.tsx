import { useRef, useState } from "react";
import { Card } from "../ui/Primitives";
import { buildAppPackage, installPackage } from "../device/appPackage";

/**
 * 方法2：纯网页造应用。选模板、填参数 → 浏览器里打成 .tgz → 装到模拟器上直接跑。
 * 不需要任何本地环境；模拟器不在线时按钮禁用。
 */

type Tpl = "offwork" | "timer" | "status";

const TEMPLATES: { id: Tpl; name: string; desc: string }[] = [
  { id: "offwork", name: "收工倒计时", desc: "倒数到收工时间，到点换成醒目提示" },
  { id: "timer", name: "倒计时器", desc: "从现在起倒数 N 分钟，常用于番茄钟" },
  { id: "status", name: "文字状态屏", desc: "大字标题 + 副标题 + 底色，做一块自己的状态牌" },
];

/** 固件 JerryScript 运行时：ES5、fetch 走 http://localhost 设备 API、Back 退出按惯例延迟解绑 */
const MAIN_OFFWORK = (app: string, off: string, done: string) => `var APP=${JSON.stringify(app)},BASE="http://localhost",OFF=${JSON.stringify(off)},DONE=${JSON.stringify(done)};
function target(){var p=OFF.split(":"),d=new Date();d.setHours(+p[0]||18,+p[1]||0,0,0);return Math.floor(d.getTime()/1000);}
function post(els){fetch(BASE+"/api/display/draw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({application_name:APP,priority:50,elements:els})}).then(function(r){if(!r.ok)console.error(APP+": "+r.status)}).catch(function(e){console.error(APP+": "+e)});}
var done=false;
post([{id:"t",type:"text",text:"OFF AT "+OFF,font:"small",color:"#FFFFFFCC",x:36,y:0,align:"top_mid",z_index:1},{id:"cd",type:"countdown",timestamp:String(target()),direction:"time_left",show_hours:"when_non_zero",x:36,y:9,align:"center",z_index:1,color:"#FFFFFFFF"}]);
var iv=setInterval(function(){if(done||Date.now()/1000<target())return;done=true;clearInterval(iv);post([{id:"ov",type:"rectangle",x:0,y:0,width:72,height:16,fill:"solid",fill_colors:["#000000FF"],z_index:5},{id:"dt",type:"text",text:DONE,font:"extra_large",color:"#2F9E62FF",x:36,y:9,align:"center",z_index:6}]);},10000);
var unbind=listen("input",function(ev){if(ev.key!=="back"||ev.action!=="short")return;clearInterval(iv);setTimeout(unbind,0);});
`;

const MAIN_TIMER = (app: string, minutes: number, done: string) => `var APP=${JSON.stringify(app)},BASE="http://localhost",DONE=${JSON.stringify(done)};
var target=Math.floor(Date.now()/1000)+${Math.max(1, Math.floor(minutes))}*60;
function post(els){fetch(BASE+"/api/display/draw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({application_name:APP,priority:50,elements:els})}).then(function(r){if(!r.ok)console.error(APP+": "+r.status)}).catch(function(e){console.error(APP+": "+e)});}
var done=false;
post([{id:"t",type:"text",text:"COUNTDOWN",font:"small",color:"#FFFFFFCC",x:36,y:0,align:"top_mid",z_index:1},{id:"cd",type:"countdown",timestamp:String(target),direction:"time_left",show_hours:"when_non_zero",x:36,y:9,align:"center",z_index:1,color:"#FFFFFFFF"}]);
var iv=setInterval(function(){if(done||Date.now()/1000<target)return;done=true;clearInterval(iv);post([{id:"ov",type:"rectangle",x:0,y:0,width:72,height:16,fill:"solid",fill_colors:["#000000FF"],z_index:5},{id:"dt",type:"text",text:DONE,font:"extra_large",color:"#E8A33DFF",x:36,y:9,align:"center",z_index:6}]);},5000);
var unbind=listen("input",function(ev){if(ev.key!=="back"||ev.action!=="short")return;clearInterval(iv);setTimeout(unbind,0);});
`;

const MAIN_STATUS = (app: string, color: string, label: string, sub: string) => `var APP=${JSON.stringify(app)},BASE="http://localhost";
fetch(BASE+"/api/display/draw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({application_name:APP,priority:50,elements:[
{id:"bg",type:"rectangle",x:0,y:0,width:72,height:16,fill:"solid",fill_colors:["#${color}FF"],z_index:0},
{id:"lbl",type:"text",text:${JSON.stringify(label)},font:"extra_large",color:"#FFFFFFFF",x:36,y:8,align:"center",z_index:1}
${sub ? `,{id:"sub",type:"text",text:${JSON.stringify(sub)},font:"tiny",color:"#FFFFFFCC",x:36,y:15,align:"bottom_mid",z_index:1}` : ""}
]})}).then(function(r){if(!r.ok)console.error(APP+": "+r.status)}).catch(function(e){console.error(APP+": "+e)});
var unbind=listen("input",function(ev){if(ev.key!=="back"||ev.action!=="short")return;setTimeout(unbind,0);});
`;

const inputCss: React.CSSProperties = { background: "var(--surface-2, #f5f5f7)", border: "1px solid var(--line, #e5e5ea)", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "inherit" };

export function QuickApp({ alive }: { alive: boolean | null }) {
  const [tpl, setTpl] = useState<Tpl>("offwork");
  const [name, setName] = useState("收工倒计时");
  const [offTime, setOffTime] = useState("18:00");
  const [doneText, setDoneText] = useState("GO HOME!");
  const [minutes, setMinutes] = useState(25);
  const [title, setTitle] = useState("FOCUS");
  const [sub, setSub] = useState("");
  const [color, setColor] = useState("#d64545");
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickTpl = (t: Tpl) => {
    setTpl(t);
    setName(TEMPLATES.find((x) => x.id === t)?.name ?? "");
    setSaid(null);
  };

  const spec = (): { id: string; name: string; color: string; mainJs: string } => {
    const id = `app.sgp.quick.${tpl}`;
    if (tpl === "offwork") return { id, name: name || "收工倒计时", color: "2f9e62", mainJs: MAIN_OFFWORK(id, offTime || "18:00", doneText || "GO HOME!") };
    if (tpl === "timer") return { id, name: name || "倒计时", color: "e8a33d", mainJs: MAIN_TIMER(id, minutes, doneText || "TIME UP!") };
    return { id, name: name || "状态屏", color: color.replace("#", ""), mainJs: MAIN_STATUS(id, color.replace("#", ""), title.toUpperCase() || "STATUS", sub) };
  };

  const make = async () => {
    const s = spec();
    setBusy(`正在生成并安装「${s.name}」…`);
    setSaid(null);
    try {
      const pkg = await buildAppPackage({ id: s.id, name: s.name, description: `网页快速创建：${TEMPLATES.find((t) => t.id === tpl)?.name ?? tpl}`, colorHex: s.color, mainJs: s.mainJs });
      await installPackage(pkg, s.id);
      setSaid({ ok: true, text: `「${s.name}」已安装并启动，正在模拟器屏幕上运行。改参数再点一次即可覆盖安装。` });
    } catch (e) {
      setSaid({ ok: false, text: `安装失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy(`正在安装 ${file.name}…`);
    setSaid(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      // 从包里读 manifest 拿 app_id（gzip → ustar → appmeta/manifest.json）
      const ds = new DecompressionStream("gzip");
      const tar = new Uint8Array(await new Response(new Blob([buf.buffer as ArrayBuffer]).stream().pipeThrough(ds)).arrayBuffer());
      let appId: string | null = null;
      for (let off = 0; off + 512 <= tar.length;) {
        const n = new TextDecoder().decode(tar.subarray(off, off + 100)).replace(/\0.*$/, "");
        const size = parseInt(new TextDecoder().decode(tar.subarray(off + 124, off + 136)).trim() || "0", 8);
        if (!n || !Number.isFinite(size)) break;
        if (n.endsWith("appmeta/manifest.json")) {
          appId = JSON.parse(new TextDecoder().decode(tar.subarray(off + 512, off + 512 + size)))?.id ?? null;
          break;
        }
        off += 512 + Math.ceil(size / 512) * 512;
      }
      if (!appId) throw new Error("包里读不到 appmeta/manifest.json");
      await installPackage(buf, appId);
      setSaid({ ok: true, text: `${file.name} 已安装并启动（${appId}）。` });
    } catch (e) {
      setSaid({ ok: false, text: `安装失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <div className="card-b">
        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>快速创建应用</h3>
        <p className="hint" style={{ margin: "0 0 14px" }}>
          不写代码也能做一个应用：选模板、填参数，网页直接打成应用包安装到模拟器上运行。也可以安装别人构建好的 .tgz 包。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" title={t.desc} onClick={() => pickTpl(t.id)}
              className={tpl === t.id ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}>
              {t.name}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          {tpl === "offwork" && (
            <>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>收工时间
                <input type="time" value={offTime} onChange={(e) => setOffTime(e.target.value)} style={inputCss} />
              </label>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>到点文字
                <input value={doneText} onChange={(e) => setDoneText(e.target.value)} maxLength={12} style={{ ...inputCss, width: 110 }} />
              </label>
            </>
          )}
          {tpl === "timer" && (
            <>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>时长（分钟）
                <input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} style={{ ...inputCss, width: 80 }} />
              </label>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>到点文字
                <input value={doneText} onChange={(e) => setDoneText(e.target.value)} maxLength={12} style={{ ...inputCss, width: 110 }} />
              </label>
            </>
          )}
          {tpl === "status" && (
            <>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>标题（英文大写）
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={10} style={{ ...inputCss, width: 110 }} />
              </label>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>副标题
                <input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={16} style={{ ...inputCss, width: 130 }} />
              </label>
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>底色
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ ...inputCss, padding: 2, width: 44, height: 30 }} />
              </label>
            </>
          )}
          <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>应用名
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} style={{ ...inputCss, width: 110 }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={!alive || busy !== null} onClick={make}>
            {busy ?? "生成并安装"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!alive || busy !== null} onClick={() => fileRef.current?.click()}>
            上传 .tgz 安装
          </button>
          <input ref={fileRef} type="file" accept=".tgz,.tar.gz,application/gzip" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          {alive === false && <span className="hint">模拟器未连接，连接后可安装。</span>}
          {said && <span style={{ fontSize: 13, color: said.ok ? "var(--ok, #2f9e62)" : "var(--danger, #d64545)" }}>{said.text}</span>}
        </div>
      </div>
    </Card>
  );
}
