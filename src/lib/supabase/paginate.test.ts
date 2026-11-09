import { describe, it, expect, vi } from "vitest";
import {
  fetchAllPages,
  fetchInChunks,
  MAX_PAGES,
  PaginationLimitError,
} from "./paginate";

/** Fonte com `total` linhas e um teto `serverMax` por resposta (simula max_rows). */
function source(total: number, serverMax = 1000) {
  return vi.fn(async (from: number, to: number) => {
    const end = Math.min(to + 1, total, from + serverMax);
    const data = Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i);
    return { data, error: null };
  });
}

describe("fetchAllPages", () => {
  it("junta todas as páginas quando o total passa do tamanho da página", async () => {
    const fetchPage = source(2500);
    const { data, error } = await fetchAllPages<number>(fetchPage, 1000);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data![2499]).toBe(2499);
  });

  it("não perde linhas quando o servidor corta abaixo do tamanho pedido (max_rows=500)", async () => {
    const fetchPage = source(2500, 500);
    const { data } = await fetchAllPages<number>(fetchPage, 1000);
    expect(data).toHaveLength(2500);
    expect(new Set(data).size).toBe(2500);
  });

  it("lê uma página vazia extra e para, sem duplicar nem pular", async () => {
    const fetchPage = source(2000);
    const { data } = await fetchAllPages<number>(fetchPage, 1000);
    expect(data).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("devolve lista vazia sem erro quando não há linhas", async () => {
    const { data, error } = await fetchAllPages<number>(source(0), 1000);
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it("erro em página do meio devolve só o erro, nunca lista parcial", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: new Array(1000).fill(1), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { data, error } = await fetchAllPages<number, { message: string }>(fetchPage, 1000);
    expect(data).toBeNull();
    expect(error).toEqual({ message: "boom" });
  });

  it("estourar o teto de páginas lança erro em vez de devolver lista parcial", async () => {
    const fetchPage = vi.fn(async () => ({ data: [1], error: null }));
    await expect(fetchAllPages<number>(fetchPage, 1)).rejects.toBeInstanceOf(
      PaginationLimitError,
    );
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
  });
});

describe("fetchInChunks", () => {
  it("quebra a lista de ids em lotes e junta os resultados", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const fetchChunk = vi.fn(async (slice: number[]) => slice.map((n) => n * 2));
    const out = await fetchInChunks(ids, 200, fetchChunk);
    expect(fetchChunk).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(450);
    expect(out[449]).toBe(898);
  });

  it("não chama nada para lista vazia", async () => {
    const fetchChunk = vi.fn(async () => [] as number[]);
    await fetchInChunks([], 200, fetchChunk);
    expect(fetchChunk).not.toHaveBeenCalled();
  });
});
