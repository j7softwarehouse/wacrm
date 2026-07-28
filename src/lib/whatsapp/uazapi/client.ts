// ============================================================
// Cliente HTTP da UAZAPI.
//
// Fino de propósito: monta a URL, injeta o header `token`, e traduz
// respostas não-2xx. Toda a semântica de mensagem vive no provider.
// ============================================================

import { parseUazapiError } from "./errors";

export { parseUazapiError };

export interface UazapiConfig {
  /** Subdomínio ou URL completa. Normalizado por `normalizeBaseUrl`. */
  baseUrl: string;
  /** Token da instância. */
  token: string;
}

export interface UazapiClient {
  post<T>(path: string, body: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
}

/**
 * Aceita `"minhaempresa"` ou `"https://minhaempresa.uazapi.com"` e
 * devolve sempre a forma canônica, sem barra final.
 *
 * Força https porque o token da instância viaja no header — em http
 * ele iria em claro.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new Error("O subdomínio ou a URL da UAZAPI é obrigatório.");
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^http:\/\//i, "https://")
    : `https://${trimmed}.uazapi.com`;

  return withScheme.replace(/\/+$/, "");
}

/** Timeout por requisição. A UAZAPI pode demorar em envio de mídia. */
const REQUEST_TIMEOUT_MS = 30_000;

export function createUazapiClient(config: UazapiConfig): UazapiClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const { token } = config;

  const request = async <T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Mantém o texto cru — `parseUazapiError` lida com isso.
    }

    if (!response.ok) {
      throw parseUazapiError(response.status, parsed);
    }
    return parsed as T;
  };

  return {
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    get: <T>(path: string) => request<T>("GET", path),
  };
}
