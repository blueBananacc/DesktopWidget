/** OpenAI 兼容 /chat/completions 端点配置；key 只存本机浏览器，不进仓库 */
export const LLM_PROVIDERS = [
  { id: "siliconflow", name: "硅基流动（国内可达）", endpoint: "https://api.siliconflow.cn/v1/chat/completions", model: "Qwen/Qwen2.5-7B-Instruct" },
  { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  { id: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  { id: "groq", name: "Groq", endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.1-8b-instant" },
  { id: "custom", name: "自定义端点", endpoint: "", model: "" },
] as const;

export const LLM_KEY_URLS: Record<string, string> = {
  siliconflow: "https://cloud.siliconflow.cn/account/ak",
  deepseek: "https://platform.deepseek.com/api_keys",
  openai: "https://platform.openai.com/api-keys",
  groq: "https://console.groq.com/keys",
};

export interface LlmCfg { provider: string; endpoint: string; model: string; key: string }
const LLM_CFG_KEY = "stt-llm-cfg";
export const loadLlmCfg = (): LlmCfg => {
  try {
    const c = JSON.parse(localStorage.getItem(LLM_CFG_KEY) || "{}");
    return { provider: c.provider || "siliconflow", endpoint: c.endpoint || "", model: c.model || "", key: c.key || "" };
  } catch { return { provider: "siliconflow", endpoint: "", model: "", key: "" }; }
};
export const saveLlmCfg = (c: LlmCfg) => localStorage.setItem(LLM_CFG_KEY, JSON.stringify(c));

export const llmPresetOf = (cfg: LlmCfg) => LLM_PROVIDERS.find((p) => p.id === cfg.provider) ?? LLM_PROVIDERS[0];
export const llmEndpointOf = (cfg: LlmCfg) => (cfg.provider === "custom" ? cfg.endpoint : llmPresetOf(cfg).endpoint);
export const llmModelOf = (cfg: LlmCfg) => (cfg.provider === "custom" ? cfg.model : llmPresetOf(cfg).model);

/** OpenAI 消息对象（assistant 消息可带 tool_calls；tool 消息带 tool_call_id） */
export interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** 统一走 OpenAI 兼容 /chat/completions；错误带 HTTP 状态码便于分类 */
export async function callLlm(cfg: LlmCfg, messages: ChatMsg[], opts: { tools?: unknown[]; maxTokens?: number } = {}) {
  const res = await fetch(llmEndpointOf(cfg), {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: llmModelOf(cfg),
      messages,
      max_tokens: opts.maxTokens ?? 300,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${j.error?.message || j.message || res.statusText}`);
  return j;
}

/** 按错误串归类成给用户看的一句话 */
export const llmErrText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return /Failed to fetch|NetworkError/i.test(m) ? "网络不通或端点不可达"
    : /401|403/.test(m) ? `Key 无效或权限不足（${m}）`
    : /404/.test(m) ? `端点地址不对（${m}）`
    : `请求失败：${m}`;
};
