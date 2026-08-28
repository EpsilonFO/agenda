/**
 * Tests de la couche LLM : la traduction pivot ↔ format natif de chaque
 * provider, et la résolution de la config depuis l'environnement.
 *
 * Aucune requête réelle : `fetch` est remplacé, et on inspecte le corps envoyé.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmChat, parseJsonLoose, LlmError, MODELS, PROVIDERS } from "./index";
import { getProvider, getModel, describeLlmConfig } from "./env";
import type { LlmMessage, LlmToolDef } from "./types";

const ENV = { ...process.env };

/** Réponse JSON classique (providers /chat/completions). */
function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Réponse en flux SSE (OpenAI Responses, Anthropic Messages). */
function sseRes(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

type Call = { url: string; headers: Record<string, string>; body: any };

/** Remplace fetch et enregistre les appels ; renvoie les réponses en file. */
function stubFetch(responses: Response[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    return responses[Math.min(i++, responses.length - 1)];
  });
  return calls;
}

const TOOL: LlmToolDef = {
  type: "function",
  function: {
    name: "list_events",
    description: "Liste les événements",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const CONVERSATION: LlmMessage[] = [
  { role: "system", content: "Tu es Josiane." },
  { role: "user", content: "Mon planning ?" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "c1", function: { name: "list_events", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "c1", name: "list_events", content: "[]" },
];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Repartir d'un env propre : les valeurs héritées de la machine du dev
  // (LLM_PROVIDER, clés…) fausseraient les assertions.
  for (const k of Object.keys(process.env)) {
    if (/^(LLM_|OPENAI_|ANTHROPIC_|MISTRAL_|DEEPSEEK_)/.test(k)) delete process.env[k];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ENV };
});

/* ----------------------------- Configuration ----------------------------- */

describe("résolution de l'environnement", () => {
  it("openai par défaut", () => {
    expect(getProvider().id).toBe("openai");
  });

  it("accepte les alias familiers", () => {
    for (const [alias, id] of [
      ["claude", "anthropic"],
      ["chatgpt", "openai"],
      ["MISTRAL", "mistral"],
      ["deepseek", "deepseek"],
      ["ollama", "openai-compat"],
    ] as const) {
      process.env.LLM_PROVIDER = alias;
      expect(getProvider().id).toBe(id);
    }
  });

  it("refuse un provider inconnu au lieu de retomber sur openai", () => {
    process.env.LLM_PROVIDER = "gemini";
    expect(() => getProvider()).toThrow(LlmError);
    expect(() => getProvider()).toThrow(/inconnu/);
  });

  it("modèle : rôle > global > provider > défaut", () => {
    process.env.LLM_PROVIDER = "mistral";
    expect(getModel("planner")).toBe("mistral-large-latest");

    process.env.MISTRAL_MODEL = "mistral-medium-latest";
    expect(getModel("planner")).toBe("mistral-medium-latest");

    process.env.LLM_MODEL = "magistral-medium-latest";
    expect(getModel("planner")).toBe("magistral-medium-latest");

    process.env.LLM_MODEL_PLANNER = "mistral-large-2411";
    expect(getModel("planner")).toBe("mistral-large-2411");
    expect(getModel("small")).toBe("magistral-medium-latest");
  });

  it("n'applique OPENAI_MODEL_* que sur OpenAI", () => {
    process.env.OPENAI_MODEL_PLANNER = "gpt-5.6-luna";
    process.env.LLM_PROVIDER = "openai";
    expect(MODELS.planner).toBe("gpt-5.6-luna");

    process.env.LLM_PROVIDER = "mistral";
    expect(MODELS.planner).toBe("mistral-large-latest");
  });

  it("nomme la variable à renseigner quand la clé manque", async () => {
    process.env.LLM_PROVIDER = "claude";
    await expect(llmChat({ messages: [{ role: "user", content: "hé" }] })).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it("décrit la config active sans jeter", () => {
    process.env.LLM_PROVIDER = "deepseek";
    expect(describeLlmConfig()).toContain("DeepSeek");
    expect(describeLlmConfig()).toContain("DEEPSEEK_API_KEY absente");
  });
});

/* -------------------------------- Mistral -------------------------------- */

describe("provider mistral (/chat/completions)", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "mistral";
    process.env.MISTRAL_API_KEY = "k";
  });

  it("envoie le format pivot tel quel et parse la réponse", async () => {
    const calls = stubFetch([
      jsonRes({
        choices: [
          {
            message: {
              content: "Voilà.",
              tool_calls: [
                { id: "t1", function: { name: "list_events", arguments: '{"a":1}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { completion_tokens: 12 },
      }),
    ]);

    const out = await llmChat({ messages: CONVERSATION, tools: [TOOL] });

    expect(calls[0].url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
    expect(calls[0].body.model).toBe("mistral-large-latest");
    expect(calls[0].body.tools).toEqual([TOOL]);
    expect(calls[0].body.tool_choice).toBe("auto");

    // content null refusé par l'API : l'assistant sans texte part avec "".
    const assistant = calls[0].body.messages[2];
    expect(assistant).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "c1", type: "function", function: { name: "list_events", arguments: "{}" } },
      ],
    });
    expect(calls[0].body.messages[3]).toEqual({
      role: "tool",
      tool_call_id: "c1",
      name: "list_events",
      content: "[]",
    });

    expect(out.content).toBe("Voilà.");
    expect(out.tool_calls).toEqual([
      { id: "t1", function: { name: "list_events", arguments: '{"a":1}' } },
    ]);
    // Rien à rejouer : ce dialecte relit le message pivot sans traduction.
    expect(out._raw).toBeUndefined();
  });

  it("active le mode JSON natif", async () => {
    const calls = stubFetch([jsonRes({ choices: [{ message: { content: "{}" } }] })]);
    await llmChat({ messages: [{ role: "user", content: "donne du JSON" }], json: true });
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("injecte le mot « json » quand le prompt ne le contient pas", async () => {
    const calls = stubFetch([jsonRes({ choices: [{ message: { content: "{}" } }] })]);
    await llmChat({
      messages: [
        { role: "system", content: "Tu planifies." },
        { role: "user", content: "Ma semaine ?" },
      ],
      json: true,
    });
    // Plusieurs implémentations (DeepSeek) refusent json_object sans le mot.
    expect(calls[0].body.messages[0].content).toMatch(/json/i);
  });
});

/* ------------------------------- Anthropic ------------------------------- */

describe("provider anthropic (/messages)", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "claude";
    process.env.ANTHROPIC_API_KEY = "k";
  });

  const REPLY = [
    { type: "message_start", message: {} },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Voilà." } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "tu1", name: "list_events", input: {} },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"a":' },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: "1}" },
    },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];

  it("sort le système, regroupe les tool_result, traduit les outils", async () => {
    const calls = stubFetch([sseRes(REPLY)]);
    const out = await llmChat({ messages: CONVERSATION, tools: [TOOL], effort: "low" });

    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("k");
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");

    // Le prompt système est un champ, pas un message.
    expect(calls[0].body.system).toBe("Tu es Josiane.");
    expect(calls[0].body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Mon planning ?" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "c1", name: "list_events", input: {} }],
      },
      // Le résultat d'outil revient côté user, pas dans un rôle "tool".
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "[]" }] },
    ]);

    // parameters → input_schema, et l'outil est aplati.
    expect(calls[0].body.tools).toEqual([
      {
        name: "list_events",
        description: "Liste les événements",
        input_schema: { type: "object", properties: {}, required: [] },
      },
    ]);
    expect(calls[0].body.max_tokens).toBeGreaterThan(calls[0].body.thinking.budget_tokens);

    expect(out.content).toBe("Voilà.");
    expect(out.tool_calls).toEqual([
      { id: "tu1", function: { name: "list_events", arguments: '{"a":1}' } },
    ]);
  });

  it("traduit l'effort en budget de raisonnement, et none le désactive", async () => {
    const calls = stubFetch([sseRes(REPLY), sseRes(REPLY)]);

    await llmChat({ messages: [{ role: "user", content: "hé" }], effort: "xhigh" });
    expect(calls[0].body.thinking).toEqual({ type: "enabled", budget_tokens: 24000 });

    await llmChat({ messages: [{ role: "user", content: "hé" }], effort: "none" });
    expect(calls[1].body.thinking).toBeUndefined();
  });

  it("rejoue les blocs natifs (thinking signé) au tour suivant", async () => {
    const calls = stubFetch([sseRes(REPLY)]);
    const blocks = [
      { type: "thinking", thinking: "…", signature: "sig" },
      { type: "tool_use", id: "tu1", name: "list_events", input: {} },
    ];
    await llmChat({
      messages: [
        { role: "user", content: "hé" },
        { role: "assistant", content: "", _raw: { provider: "anthropic", items: blocks } },
        { role: "tool", tool_call_id: "tu1", content: "[]" },
      ],
    });
    expect(calls[0].body.messages[1]).toEqual({ role: "assistant", content: blocks });
  });

  it("ignore le _raw d'un autre provider et reconstruit le message", async () => {
    const calls = stubFetch([sseRes(REPLY)]);
    await llmChat({
      messages: [
        { role: "user", content: "hé" },
        {
          role: "assistant",
          content: "ok",
          tool_calls: [{ id: "c1", function: { name: "list_events", arguments: "{}" } }],
          _raw: { provider: "openai", items: [{ type: "reasoning", id: "rs_1" }] },
        },
        { role: "tool", tool_call_id: "c1", content: "[]" },
      ],
    });
    expect(calls[0].body.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "c1", name: "list_events", input: {} },
      ],
    });
  });

  it("passe par une instruction faute de mode JSON natif", async () => {
    const calls = stubFetch([sseRes(REPLY)]);
    await llmChat({
      messages: [
        { role: "system", content: "Tu planifies." },
        { role: "user", content: "Ma semaine ?" },
      ],
      json: true,
    });
    expect(calls[0].body.response_format).toBeUndefined();
    expect(calls[0].body.system).toMatch(/JSON valide/);
  });
});

/* --------------------------------- OpenAI -------------------------------- */

describe("provider openai (/responses)", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "k";
  });

  const REPLY = [
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          { type: "reasoning", id: "rs_1", summary: [] },
          { type: "message", content: [{ type: "output_text", text: "Voilà." }] },
          { type: "function_call", call_id: "c9", name: "list_events", arguments: "{}" },
        ],
        usage: { output_tokens: 20, output_tokens_details: { reasoning_tokens: 15 } },
      },
    },
  ];

  it("aplatit les outils et convertit les messages en items", async () => {
    const calls = stubFetch([sseRes(REPLY)]);
    const out = await llmChat({ messages: CONVERSATION, tools: [TOOL], effort: "high" });

    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0].body.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(calls[0].body.tools).toEqual([
      {
        type: "function",
        name: "list_events",
        description: "Liste les événements",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ]);
    expect(calls[0].body.input[3]).toEqual({
      type: "function_call_output",
      call_id: "c1",
      output: "[]",
    });

    expect(out.content).toBe("Voilà.");
    expect(out.tool_calls).toEqual([
      { id: "c9", function: { name: "list_events", arguments: "{}" } },
    ]);
    // Les items de raisonnement doivent pouvoir être rejoués tels quels.
    expect(out._raw).toEqual({ provider: "openai", items: REPLY[0].response.output });
  });

  it("rejoue _raw plutôt que le message reconstruit", async () => {
    const calls = stubFetch([sseRes(REPLY)]);
    const items = [{ type: "reasoning", id: "rs_1" }, { type: "message", content: [] }];
    await llmChat({
      messages: [
        { role: "user", content: "hé" },
        { role: "assistant", content: "ok", _raw: { provider: "openai", items } },
      ],
    });
    expect(calls[0].body.input).toEqual([{ role: "user", content: "hé" }, ...items]);
  });

  it("coupe les résumés de raisonnement si l'API les refuse (400)", async () => {
    const calls = stubFetch([
      jsonRes({ error: { message: "Unsupported parameter: reasoning.summary" } }, 400),
      sseRes(REPLY),
    ]);
    const out = await llmChat({ messages: [{ role: "user", content: "hé" }] });
    expect(calls[0].body.reasoning.summary).toBe("auto");
    expect(calls[1].body.reasoning).toEqual({ effort: "xhigh" });
    expect(out.content).toBe("Voilà.");
  });
});

/* --------------------------- Erreurs & retries --------------------------- */

describe("erreurs", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "mistral";
    process.env.MISTRAL_API_KEY = "k";
  });

  it("ne retente pas une erreur définitive et remonte le message de l'API", async () => {
    const calls = stubFetch([jsonRes({ message: "Invalid model" }, 422)]);
    const err = await llmChat({ messages: [{ role: "user", content: "hé" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(422);
    expect(err.provider).toBe("Mistral");
    expect(err.message).toBe("Invalid model");
    expect(calls).toHaveLength(1);
  });

  it("retente un 429 puis réussit", async () => {
    vi.useFakeTimers();
    const calls = stubFetch([
      jsonRes({ message: "rate limited" }, 429),
      jsonRes({ choices: [{ message: { content: "ok" } }] }),
    ]);
    const p = llmChat({ messages: [{ role: "user", content: "hé" }] });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toMatchObject({ content: "ok" });
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it("refuse les outils sur un provider qui n'en fait pas", async () => {
    process.env.LLM_PROVIDER = "mistral";
    const spec = getProvider();
    const original = spec.capabilities.tools;
    spec.capabilities.tools = false;
    try {
      await expect(
        llmChat({ messages: [{ role: "user", content: "hé" }], tools: [TOOL] })
      ).rejects.toThrow(/appels d'outils/);
    } finally {
      spec.capabilities.tools = original;
    }
  });
});

/* ------------------------------ parseJsonLoose --------------------------- */

describe("parseJsonLoose", () => {
  it("parse du JSON pur", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("extrait l'objet d'un texte qui l'entoure (providers sans mode JSON)", () => {
    expect(parseJsonLoose('Voici :\n```json\n{"a":1}\n```\nVoilà.')).toEqual({ a: 1 });
  });

  it("renvoie null si rien d'exploitable", () => {
    expect(parseJsonLoose("désolé")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
});

/* ------------------------------ openai-compat ---------------------------- */

describe("provider openai-compat (serveur local)", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "ollama";
    process.env.LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.LLM_MODEL = "qwen2.5:14b";
  });

  it("tourne sans clé API et n'envoie pas d'en-tête Authorization vide", async () => {
    const calls = stubFetch([jsonRes({ choices: [{ message: { content: "ok" } }] })]);
    const out = await llmChat({ messages: [{ role: "user", content: "hé" }], tools: [TOOL] });

    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body.model).toBe("qwen2.5:14b");
    expect(calls[0].body.tools).toEqual([TOOL]);
    expect(out.content).toBe("ok");
  });

  it("ajoute la clé si le serveur en demande une", async () => {
    process.env.LLM_API_KEY = "secret";
    const calls = stubFetch([jsonRes({ choices: [{ message: { content: "ok" } }] })]);
    await llmChat({ messages: [{ role: "user", content: "hé" }] });
    expect(calls[0].headers.Authorization).toBe("Bearer secret");
  });

  it("exige LLM_MODEL, sans défaut inventé", async () => {
    delete process.env.LLM_MODEL;
    await expect(llmChat({ messages: [{ role: "user", content: "hé" }] })).rejects.toThrow(
      /renseigne LLM_MODEL\./
    );
  });

  it("fabrique un id d'appel si le serveur l'omet", async () => {
    stubFetch([
      jsonRes({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [{ function: { name: "list_events", arguments: { a: 1 } } }],
            },
          },
        ],
      }),
    ]);
    const out = await llmChat({ messages: [{ role: "user", content: "hé" }], tools: [TOOL] });
    // Sans id, le message `tool` de réponse ne pourrait pas être rattaché.
    expect(out.tool_calls).toEqual([
      { id: "call_0", function: { name: "list_events", arguments: '{"a":1}' } },
    ]);
  });
});

describe("catalogue des providers", () => {
  it("n'a aucun alias en double (sinon la résolution dépend de l'ordre)", () => {
    const seen = new Map<string, string>();
    for (const p of Object.values(PROVIDERS)) {
      for (const name of [p.id, ...p.aliases]) {
        expect(seen.has(name), `"${name}" déjà pris par ${seen.get(name)}`).toBe(false);
        seen.set(name, p.id);
      }
    }
  });

  it("résout les alias de serveur local", () => {
    for (const alias of ["local", "localmodel", "qwen", "ollama"]) {
      process.env.LLM_PROVIDER = alias;
      expect(getProvider().id).toBe("openai-compat");
    }
  });
});
