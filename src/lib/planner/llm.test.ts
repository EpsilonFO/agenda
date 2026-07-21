import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentOutputError, callJson, type ChatFn } from "./llm";

const schema = z.object({ count: z.number() });

function fakeChat(replies: string[]): { chat: ChatFn; calls: () => number } {
  let i = 0;
  return {
    chat: async () => ({ content: replies[Math.min(i++, replies.length - 1)] }),
    calls: () => i,
  };
}

describe("callJson", () => {
  it("renvoie l'objet validé du premier coup", async () => {
    const { chat, calls } = fakeChat(['{"count": 3}']);
    const out = await callJson(schema, {
      agent: "test",
      model: "m",
      system: "s",
      user: "u",
      chat,
    });
    expect(out).toEqual({ count: 3 });
    expect(calls()).toBe(1);
  });

  it("retente avec le feedback d'erreur puis réussit", async () => {
    const { chat, calls } = fakeChat(['{"count": "trois"}', '{"count": 3}']);
    const out = await callJson(schema, {
      agent: "test",
      model: "m",
      system: "s",
      user: "u",
      chat,
    });
    expect(out).toEqual({ count: 3 });
    expect(calls()).toBe(2);
  });

  it("tolère du texte autour du JSON (parse loose)", async () => {
    const { chat } = fakeChat(['Voilà :\n{"count": 3}\nBonne journée !']);
    const out = await callJson(schema, {
      agent: "test",
      model: "m",
      system: "s",
      user: "u",
      chat,
    });
    expect(out).toEqual({ count: 3 });
  });

  it("lève AgentOutputError après épuisement des retries", async () => {
    const { chat, calls } = fakeChat(["pas du json"]);
    await expect(
      callJson(schema, {
        agent: "emilien",
        model: "m",
        system: "s",
        user: "u",
        maxRetries: 2,
        chat,
      })
    ).rejects.toThrow(AgentOutputError);
    expect(calls()).toBe(3); // 1 essai + 2 retries
  });
});
