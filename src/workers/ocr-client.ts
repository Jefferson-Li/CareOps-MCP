const OCR_URL = process.env.OCR_URL ?? "http://127.0.0.1:3850";

export type OcrResult = {
  engine: string;
  text: string;
  fields: Record<string, string>;
  image_size?: number[] | null;
  notes?: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${OCR_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ?? `OCR worker HTTP ${res.status}`);
  }
  return data;
}

export const ocrWorker = {
  health: () =>
    request<{ ok: boolean; tesseract: boolean; mode: string }>("/health"),
  ocrPath: (path: string) =>
    request<OcrResult>("/ocr/path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  ensureSample: () =>
    request<{ path: string }>("/admin/ensure-sample", {
      method: "POST",
      body: "{}",
    }),
};
