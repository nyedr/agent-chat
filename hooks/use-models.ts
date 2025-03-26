"use client";

import useSWR from "swr";
import type { ModelDisplay } from "@/lib/ai/models";
import { transformModels } from "@/lib/ai/models";

async function fetchModels(url: string) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_CHAT_API_KEY}`,
    },
  });

  if (!res.ok) throw new Error("Failed to fetch models");

  const json = await res.json();

  // Check if the response is an array or an object with a 'models' property
  const models = json.data;

  return transformModels(models);
}

export function useModels() {
  const { data, error, isLoading } = useSWR<ModelDisplay[]>(
    `${process.env.NEXT_PUBLIC_CHAT_BASE_URL}/models`,
    fetchModels
  );

  return {
    models: data || [],
    isLoading,
    error,
  };
}
